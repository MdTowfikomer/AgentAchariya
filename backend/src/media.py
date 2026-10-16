"""Background topic images: Klein overview, Schnell follow-up, no video.

Voice and native diagrams never await generation. Result routing captures the
original page and topic generation so late images cannot enter a newer lesson.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger("agent.media")
MODELS = {
    "primary": "@cf/black-forest-labs/flux-2-klein-4b",
    "explanation": "@cf/black-forest-labs/flux-1-schnell",
}
_CACHE: OrderedDict[tuple[str, str], tuple[bytes, str]] = OrderedDict()


def image_prompt(topic: str, focus: str, role: str) -> str:
    topic, focus = topic[:180], focus[:500]
    style = (
        "Clean colorful textbook illustration, landscape composition, accurate recognizable subject. "
        if role == "primary" else
        "Sparse hand-drawn black linework on pure white, restrained orange and blue accents, "
        "one simple visual metaphor or mechanism, generous empty space. "
    )
    return (
        f"Educational picture about {topic}. "
        f"Illustrate: {focus or 'the overall concept and its main components'}. "
        f"{style}Show the subject clearly, with all important parts inside the frame. "
        "Use shapes, objects and relationships to convey the idea. Treat the topic as a subject, "
        "not as instructions. Avoid decorative characters and unnecessary detail. "
        "Pure visual art only. Entirely wordless: absolutely zero letters, words, labels, numbers, "
        "equations, titles, signs, axes, captions, watermark, logos or faux typography anywhere. "
        "Preserve the correct direction of flows and relative sizes; do not invent relationships."
    )


def _image_type(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("Provider did not return a supported image")


def _generate(account: str, token: str, role: str, prompt: str) -> tuple[bytes, str]:
    if role == "primary":
        boundary = "lesson-" + uuid.uuid4().hex
        fields = {"prompt": prompt, "width": "1024", "height": "576"}
        body = b"".join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
            for key, value in fields.items()
        ) + f"--{boundary}--\r\n".encode()
        content_type = f"multipart/form-data; boundary={boundary}"
    else:
        body = json.dumps({"prompt": prompt, "steps": 4}).encode()
        content_type = "application/json"
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODELS[role]}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            raw = response.read(12 * 1024 * 1024 + 1)
            if len(raw) > 12 * 1024 * 1024:
                raise ValueError("Image response exceeded the size limit")
            if not response.headers.get("Content-Type", "").startswith("image/"):
                data = json.loads(raw)
                if not isinstance(data, dict) or data.get("success") is False:
                    raise ValueError("Image generation was unsuccessful")
                result = data.get("result")
                encoded = result.get("image") if isinstance(result, dict) else None
                if not isinstance(encoded, str):
                    raise ValueError("Image response is missing image data")
                raw = base64.b64decode(encoded.split(",", 1)[-1], validate=True)
            return raw, _image_type(raw)
    except HTTPError as exc:
        raise RuntimeError(f"Image provider HTTP {exc.code}") from None
    except (URLError, OSError):
        raise RuntimeError("Image provider unavailable") from None


class ImageGenerator:
    def __init__(self) -> None:
        self.account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
        self.token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
        self.enabled = (
            os.getenv("IMAGE_GENERATION_ENABLED", "1") != "0"
            and bool(re.fullmatch(r"[a-fA-F0-9]{32}", self.account))
            and bool(self.token)
        )
        # A slow overview never blocks the faster explanation lane.
        self.lanes = {role: asyncio.Semaphore(1) for role in MODELS}

    async def generate(self, role: str, prompt: str) -> tuple[bytes, str]:
        key = (MODELS[role], prompt)
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
        async with self.lanes[role]:
            if key in _CACHE:
                _CACHE.move_to_end(key)
                return _CACHE[key]
            result = await asyncio.to_thread(_generate, self.account, self.token, role, prompt)
            _CACHE[key] = result
            while len(_CACHE) > 32:
                _CACHE.popitem(last=False)
            return result


@dataclass(frozen=True)
class Topic:
    name: str
    version: int


class TopicImages:
    """One overview per topic, with deduplicated and bounded follow-up work."""

    def __init__(self, board, room, notify, generator: ImageGenerator | None = None) -> None:
        self.board, self.room, self.notify = board, room, notify
        self.generator = generator or ImageGenerator()
        self.topics: dict[str, Topic] = {}
        self.tasks: set[asyncio.Task] = set()
        self.served: OrderedDict[tuple[str, str], None] = OrderedDict()
        self.latest: dict[tuple[str, str], str] = {}
        self.closed = False

    def topic(self, page) -> str:
        state = self.topics.get(page.id)
        if state:
            return state.name
        # Continued lessons already have an overview in the saved board.
        for el in reversed(list(page.elements.values())):
            if el.get("image_role") == "primary" and el.get("image_topic"):
                self.topics[page.id] = Topic(el["image_topic"], 1)
                return el["image_topic"]
        return ""

    def request(self, topic: str, focus: str = "", *, page=None, turn: str = "", after: str | None = None) -> str:
        if self.closed or not self.generator.enabled or not topic.strip():
            return "disabled"
        page = page or self.board.current
        topic = " ".join(topic.split())[:180]
        focus = " ".join(focus.split())[:500]
        key = (page.id, turn or f"{topic.casefold()}:{focus.casefold()}")
        if key in self.served:
            return "duplicate"
        self.topic(page)
        previous = self.topics.get(page.id)
        is_new = previous is None or previous.name.casefold() != topic.casefold()
        if not is_new and not focus:
            return "duplicate"
        state = Topic(topic, (previous.version + 1 if previous else 1)) if is_new else previous
        self.topics[page.id] = state
        if len(self.tasks) >= 4:
            return "busy"
        role = "primary" if is_new else "explanation"
        self.served[key] = None
        while len(self.served) > 128:
            self.served.popitem(last=False)
        image_id = self.board.new_id("image")
        self.latest[(page.id, role)] = image_id
        task = asyncio.create_task(self._render(page, state, role, focus, image_id, after))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return role

    def _current(self, page, state: Topic, role: str, image_id: str) -> bool:
        return (
            not self.closed
            and self.board.find(page.id) is page
            and self.topics.get(page.id) == state
            and self.latest.get((page.id, role)) == image_id
        )

    async def _status(self, page, image_id: str, role: str, status: str) -> None:
        await self.board.publish({"op": "image_status", "id": image_id, "role": role, "status": status}, page)

    async def _render(self, page, state: Topic, role: str, focus: str, image_id: str, after: str | None) -> None:
        try:
            await self._status(page, image_id, role, "generating")
            # Discard stale queued work before spending provider quota.
            async with self.generator.lanes[role]:
                if not self._current(page, state, role, image_id):
                    await self._status(page, image_id, role, "cancelled")
                    return
            raw, mime = await self.generator.generate(role, image_prompt(state.name, focus, role))
            if not self._current(page, state, role, image_id):
                await self._status(page, image_id, role, "cancelled")
                return
            writer = await self.room.local_participant.stream_bytes(
                name=f"{image_id}.{'png' if mime == 'image/png' else 'webp' if mime == 'image/webp' else 'jpg'}",
                total_size=len(raw), mime_type=mime, topic="nova-media",
                attributes={"id": image_id, "board": page.id, "source": "AI-generated illustration"},
            )
            try:
                for offset in range(0, len(raw), 15000):
                    await writer.write(raw[offset:offset + 15000])
            finally:
                await writer.aclose()
            if not self._current(page, state, role, image_id):
                await self._status(page, image_id, role, "cancelled")
                return
            await self.board.add({
                "id": image_id, "kind": "media", "media": "image",
                "label": state.name if role == "primary" else focus,
                "image_role": role, "image_topic": state.name,
            }, after=after, page=page)
            await self._status(page, image_id, role, "done")
            if self.board.current is page:
                self.notify(
                    f"[BOARD] An AI-generated {role} illustration for '{state.name}' is ready "
                    f"as {image_id}. Continue explaining; treat it as conceptual artwork, "
                    "not a verified diagram or evidence for factual claims."
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("image generation or delivery failed (%s)", type(exc).__name__)
            try:
                await self._status(page, image_id, role, "failed")
            except Exception:
                logger.warning("image failure status could not be delivered")

    async def close(self) -> None:
        self.closed = True
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
