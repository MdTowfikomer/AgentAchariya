"""Wait for topic selection while the classroom connects."""

import asyncio


def request_topic_overview(images, page, topic: str) -> str:
    """Start the opening illustration without delaying the teacher's voice."""
    return images.request(
        topic,
        "A clear visual overview of the topic and its main components",
        page=page,
        turn=f"onboarding:{topic.casefold()}",
    )


async def wait_for_topic(room, student, timeout: float = 180) -> str:
    """Read synchronized attributes, including a choice made before we joined."""
    ready = asyncio.get_running_loop().create_future()

    def changed(attributes, participant):
        topic = attributes.get("lesson_topic", "").strip()[:160]
        if participant.identity == student.identity and topic and not ready.done():
            ready.set_result(topic)

    def left(participant):
        if participant.identity == student.identity and not ready.done():
            ready.set_exception(ConnectionError("Student left during topic selection"))

    room.on("participant_attributes_changed", changed)
    room.on("participant_disconnected", left)
    try:
        changed(student.attributes, student)
        return await asyncio.wait_for(ready, timeout=timeout)
    finally:
        room.off("participant_attributes_changed", changed)
        room.off("participant_disconnected", left)

