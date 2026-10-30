import asyncio
from types import SimpleNamespace

import pytest

from onboarding import request_topic_overview, wait_for_topic


class Room:
    def __init__(self):
        self.handlers = {}

    def on(self, event, callback):
        self.handlers[event] = callback

    def off(self, event, callback):
        assert self.handlers.pop(event) is callback


def test_selected_topic_requests_a_non_blocking_primary_overview():
    calls = []
    images = SimpleNamespace(request=lambda *args, **kwargs: calls.append((args, kwargs)) or "primary")
    page = object()

    assert request_topic_overview(images, page, "Binary Search") == "primary"
    assert calls == [
        (
            ("Binary Search", "A clear visual overview of the topic and its main components"),
            {"page": page, "turn": "onboarding:binary search"},
        )
    ]


@pytest.mark.asyncio
async def test_topic_selected_before_agent_joins_is_not_lost():
    room = Room()
    student = SimpleNamespace(identity="student", attributes={"lesson_topic": " Binary search "})
    assert await wait_for_topic(room, student) == "Binary search"
    assert room.handlers == {}


@pytest.mark.asyncio
async def test_topic_waits_for_the_right_student_and_cleans_up():
    room = Room()
    student = SimpleNamespace(identity="student", attributes={})
    task = asyncio.create_task(wait_for_topic(room, student, timeout=1))
    await asyncio.sleep(0)
    callback = room.handlers["participant_attributes_changed"]
    callback({"lesson_topic": "Wrong topic"}, SimpleNamespace(identity="other"))
    assert not task.done()
    student.attributes["lesson_topic"] = "Why ships float"
    callback({"lesson_topic": "Why ships float"}, student)
    assert await task == "Why ships float"
    assert room.handlers == {}


@pytest.mark.asyncio
async def test_timeout_removes_topic_listener():
    room = Room()
    with pytest.raises(TimeoutError):
        await wait_for_topic(room, SimpleNamespace(identity="student", attributes={}), timeout=0.001)
    assert room.handlers == {}


@pytest.mark.asyncio
async def test_leaving_during_topic_selection_releases_listener():
    room = Room()
    student = SimpleNamespace(identity="student", attributes={})
    task = asyncio.create_task(wait_for_topic(room, student))
    await asyncio.sleep(0)
    room.handlers["participant_disconnected"](student)
    with pytest.raises(ConnectionError):
        await task
    assert room.handlers == {}
