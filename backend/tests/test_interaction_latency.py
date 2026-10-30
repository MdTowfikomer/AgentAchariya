"""Ordering regressions for interactive replies; no provider calls required."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from livekit.agents import llm

from board_session import MarkRelay


@pytest.mark.asyncio
async def test_mark_waits_for_interruption_before_injecting_and_replying():
    interrupted = asyncio.get_running_loop().create_future()
    session = SimpleNamespace(
        interrupt=Mock(return_value=interrupted), generate_reply=Mock()
    )
    cls = SimpleNamespace(
        board=SimpleNamespace(current=SimpleNamespace(), revealed=1),
        images=SimpleNamespace(topic=lambda page: ""),
    )
    relay = MarkRelay(session, cls)
    relay._follow_page = AsyncMock()
    relay._describe = Mock(return_value="The student circled the seeds.")
    relay._inject = AsyncMock()
    relay.flush = AsyncMock()
    reader = SimpleNamespace(read_all=AsyncMock(return_value=json.dumps({
        "type": "mark", "ask": True, "image": "data:image/jpeg;base64,example",
    })))

    task = asyncio.create_task(relay.handle(reader, "student"))
    await asyncio.sleep(0)
    try:
        relay._inject.assert_not_awaited()
        session.generate_reply.assert_not_called()
    finally:
        interrupted.set_result(None)
        await task

    relay._inject.assert_awaited_once()
    assert relay._inject.await_args.args[1].startswith("data:image/")
    session.generate_reply.assert_called_once()
    assert "Answer the latest student request aloud now" in session.generate_reply.call_args.kwargs["instructions"]


@pytest.mark.asyncio
async def test_checkpoint_feedback_is_not_queued_a_second_time():
    session = SimpleNamespace(
        interrupt=AsyncMock(), generate_reply=Mock(), agent_state="thinking"
    )
    board = SimpleNamespace(
        evaluate_answer=lambda *args: (True, "Correct"),
        current=SimpleNamespace(), publish=AsyncMock(),
    )
    relay = MarkRelay(session, SimpleNamespace(board=board, lang="en"))
    relay._follow_page = AsyncMock()
    relay._inject = AsyncMock()
    reader = SimpleNamespace(read_all=AsyncMock(return_value=json.dumps({
        "type": "checkpoint_response", "checkpointId": "cp-1", "response": "seed",
    })))

    await relay.handle(reader, "student")

    relay._inject.assert_awaited_once()
    assert relay._held == []
    session.generate_reply.assert_called_once()


@pytest.mark.asyncio
async def test_simultaneous_context_updates_do_not_overwrite_each_other(monkeypatch):
    first_update = asyncio.Event()
    release = asyncio.Event()
    teacher = SimpleNamespace(chat_ctx=llm.ChatContext.empty())

    async def update(ctx):
        if not first_update.is_set():
            first_update.set()
            await release.wait()
        teacher.chat_ctx = ctx

    teacher.update_chat_ctx = AsyncMock(side_effect=update)
    monkeypatch.setattr(MarkRelay, "teacher", property(lambda self: teacher))
    relay = MarkRelay(SimpleNamespace(), SimpleNamespace())
    one = asyncio.create_task(relay._inject("First board fact"))
    await first_update.wait()
    two = asyncio.create_task(relay._inject("Second board fact"))
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(one, two)

    assert [m.text_content for m in teacher.chat_ctx.messages()] == [
        "First board fact", "Second board fact",
    ]


