"""Image routing, latency isolation, caching, and provider failures."""

import asyncio
import base64
import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.error import HTTPError

import pytest

import media
from board import Board

JPEG = b"\xff\xd8\xfftest-image"


def make_pipeline(generator=None):
    writer = SimpleNamespace(write=AsyncMock(), aclose=AsyncMock())
    participant = SimpleNamespace(publish_data=AsyncMock(), stream_bytes=AsyncMock(return_value=writer))
    room = SimpleNamespace(local_participant=participant)
    board = Board(room)
    if generator is None:
        generator = SimpleNamespace(
            enabled=True, lanes={role: asyncio.Semaphore(1) for role in media.MODELS},
            generate=AsyncMock(return_value=(JPEG, "image/jpeg")),
        )
    notify = Mock()
    return media.TopicImages(board, room, notify, generator), board, participant, writer


async def drain(pipeline):
    await asyncio.gather(*list(pipeline.tasks))


@pytest.mark.asyncio
async def test_one_primary_then_followups_and_turn_deduplication():
    pipeline, board, participant, writer = make_pipeline()
    assert pipeline.request("Photosynthesis", turn="question1") == "primary"
    assert pipeline.request("Photosynthesis", "Overview", turn="question1") == "duplicate"
    await drain(pipeline)
    assert pipeline.request("Photosynthesis", "Water enters roots", turn="question2") == "explanation"
    await drain(pipeline)
    assert [call.args[0] for call in pipeline.generator.generate.await_args_list] == ["primary", "explanation"]
    assert [el["image_role"] for el in board.elements.values()] == ["primary", "explanation"]
    assert participant.stream_bytes.await_count == 2
    assert writer.write.await_count == 2


@pytest.mark.asyncio
async def test_board_switch_does_not_route_result_to_new_page():
    pipeline, board, _, _ = make_pipeline()
    original = board.current
    pipeline.request("Water cycle", page=original, turn="q1")
    await board.new_page(page_id="b2")
    await drain(pipeline)
    assert len(original.elements) == 1
    assert not board.current.elements
    pipeline.notify.assert_not_called()


@pytest.mark.asyncio
async def test_late_old_topic_is_discarded_and_current_topic_is_preserved():
    started, release = asyncio.Event(), asyncio.Event()

    async def generate(role, prompt):
        if "Old topic" in prompt:
            started.set()
            await release.wait()
        return JPEG, "image/jpeg"

    generator = SimpleNamespace(enabled=True, lanes={r: asyncio.Semaphore(1) for r in media.MODELS}, generate=generate)
    pipeline, board, participant, _ = make_pipeline(generator)
    pipeline.request("Old topic", turn="q1")
    await started.wait()
    pipeline.request("New topic", turn="q2")
    release.set()
    await drain(pipeline)
    assert [el["image_topic"] for el in board.elements.values()] == ["New topic"]
    assert participant.stream_bytes.await_count == 1


@pytest.mark.asyncio
async def test_failure_does_not_clear_board_or_block_other_visuals():
    pipeline, board, participant, _ = make_pipeline()
    await board.add({"id": "diagram", "kind": "diagram"})
    pipeline.generator.generate.side_effect = RuntimeError("provider quota")
    pipeline.request("Topic", turn="q1")
    await drain(pipeline)
    assert list(board.elements) == ["diagram"]
    ops = [json.loads(call.args[0]) for call in participant.publish_data.await_args_list]
    assert ops[-1]["status"] == "failed"
    participant.stream_bytes.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("placement", ["steps", "images"])
async def test_restored_primary_is_not_regenerated(placement):
    pipeline, board, _, _ = make_pipeline()
    saved = {
        "id": "saved", "kind": "media", "media": "image", "image_role": "primary", "image_topic": "Water cycle",
    }
    page = {"revealed": 1, "steps": [{"elements": [saved]}]} if placement == "steps" else {"images": [{"element": saved}]}
    board.restore({"order": ["b1"], "active": "b1", "pages": {"b1": page}})
    assert pipeline.request("Water cycle") == "duplicate"
    assert pipeline.request("Water cycle", "Explain evaporation", turn="q2") == "explanation"
    await drain(pipeline)
    assert pipeline.generator.generate.await_args.args[0] == "explanation"


@pytest.mark.asyncio
async def test_loading_lesson_preserves_delivered_image():
    pipeline, board, _, _ = make_pipeline()
    pipeline.request("Water cycle", turn="q1")
    await drain(pipeline)
    await board.load_lesson({"title": "Water cycle", "steps": []})
    assert len(board.elements) == 1


@pytest.mark.asyncio
async def test_shutdown_prevents_delivery_and_new_requests():
    started = asyncio.Event()

    async def generate(*args):
        started.set()
        await asyncio.Event().wait()

    generator = SimpleNamespace(enabled=True, lanes={r: asyncio.Semaphore(1) for r in media.MODELS}, generate=generate)
    pipeline, board, participant, _ = make_pipeline(generator)
    pipeline.request("Water cycle", turn="q1")
    await started.wait()
    await pipeline.close()
    assert pipeline.request("Other topic") == "disabled"
    assert not board.elements
    participant.stream_bytes.assert_not_awaited()


@pytest.mark.asyncio
async def test_explanation_lane_is_independent_and_repeat_result_is_cached(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "a" * 32)
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "secret-token")
    monkeypatch.setattr(media, "_CACHE", media.OrderedDict())
    generate = Mock(return_value=(JPEG, "image/jpeg"))
    monkeypatch.setattr(media, "_generate", generate)
    generator = media.ImageGenerator()
    await generator.lanes["primary"].acquire()
    try:
        result = await asyncio.wait_for(generator.generate("explanation", "Explain roots"), timeout=1)
    finally:
        generator.lanes["primary"].release()
    assert result[0] == JPEG
    assert await generator.generate("explanation", "Explain roots") == result
    generate.assert_called_once()


@pytest.mark.parametrize("role", ["primary", "explanation"])
def test_live_provider_contract_and_wordless_prompt(monkeypatch, role):
    requests = []

    class Response(io.BytesIO):
        @property
        def headers(self):
            return {"Content-Type": "application/json"}

    def respond(request, timeout):
        requests.append(request)
        return Response(json.dumps({"success": True, "result": {"image": base64.b64encode(JPEG).decode()}}).encode())

    monkeypatch.setattr(media, "urlopen", respond)
    prompt = media.image_prompt("Water cycle", "Evaporation", role)
    assert "Entirely wordless" in prompt
    assert media._generate("a" * 32, "secret-token", role, prompt) == (JPEG, "image/jpeg")
    if role == "primary":
        assert requests[0].headers["Content-type"].startswith("multipart/form-data")
        assert b"1024" in requests[0].data
    else:
        assert json.loads(requests[0].data)["steps"] == 4


def test_provider_http_error_redacts_credentials(monkeypatch):
    def fail(request, timeout):
        raise HTTPError(request.full_url, 403, "secret-token", None, None)

    monkeypatch.setattr(media, "urlopen", fail)
    with pytest.raises(RuntimeError) as caught:
        media._generate("a" * 32, "secret-token", "primary", "Topic")
    assert str(caught.value) == "Image provider HTTP 403"
