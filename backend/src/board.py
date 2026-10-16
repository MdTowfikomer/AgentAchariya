"""The shared whiteboard — Nova draws on it, the student marks it.

Two models split the work, because each is bad at the other's job:

    Gemini 3.8 Flash  plans a lesson as a BOARD SCRIPT: a few steps, each with
                      the exact things to draw (arrays, code, trees, tables)
                      and the points to make. Structured, deliberate, ~2s.
    Gemini 3.8 Live   teaches from that script out loud, revealing one step at
                      a time and improvising annotations when the student gets
                      stuck. Conversational, interruptible, reads tone.

Asking the Live model to invent a whole board while speaking produced dead air
and malformed layouts; asking Flash to converse produced a lecture. So Flash
writes the board and Live performs it.

Everything on the board has a stable TARGET address, which is what makes the
student's marks meaningful:

    arr1          a whole element
    arr1#3        cell 3 of an array / item 3 of a chain / line 3 of code (0-based)
    tbl1#2.1      row 2, column 1 of a table
    tree1#n4      node n4 of a tree

The browser hit-tests a student's circle against these addresses, so "idhi
enti?" arrives as "code line 3: `if a[j] <= pivot`" rather than as pixels.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

from google import genai
from google.genai import types
from livekit import rtc

from visuals import DIAGRAM_SCHEMA, clean_diagram

logger = logging.getLogger("agent.board")

BOARD_TOPIC = "nova-board"  # agent -> browser: drawing ops
STUDENT_TOPIC = "nova-board-student"  # browser -> agent: marks, via text stream

PLANNER_MODEL = os.getenv("PLANNER_MODEL", "gemini-3.1-flash-lite")
# gemini-3.1-flash-lite has a high free-tier quota (unlike preview 3.8 which is capped at 20/day).
PLANNER_FALLBACKS = [
    PLANNER_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
]

KINDS = ["text", "code", "array", "chain", "tree", "table", "diagram", "list", "media", "illustration"]
PLAN_KINDS = ["text", "code", "array", "chain", "tree", "table", "diagram", "list"]

# --- Planner output schema ---------------------------------------------------
# One sub-object per kind (`code: {...}`, `array: {...}`), filled only for the
# element's own kind. A flat object with shared field names was tried first:
# every model tested (3.6/3.7/3.8 Flash) filed code lines, chain items and
# array cells all under the table's `rows`, because it was the only
# list-of-lists. Named sub-objects leave nothing to confuse.

_S = types.Schema
_STR = _S(type="STRING")
_STRS = _S(type="ARRAY", items=_STR)

ELEMENT_SCHEMA = _S(
    type="OBJECT",
    properties={
        "id": _S(type="STRING", description="Short unique id, e.g. arr1, code1, t1."),
        "kind": _S(type="STRING", enum=PLAN_KINDS),
        "label": _S(
            type="STRING",
            description="Optional caption above an array, chain, tree or table.",
        ),
        "text": _S(
            type="STRING",
            description="ONLY for kind=text: one short line, under 60 characters.",
        ),
        "code": _S(
            type="OBJECT",
            description="ONLY for kind=code.",
            properties={
                "lang": _STR,
                "code_lines": _S(
                    type="ARRAY", items=_STR, description="At most 10 lines."
                ),
            },
            required=["code_lines"],
        ),
        "array": _S(
            type="OBJECT",
            description="ONLY for kind=array.",
            properties={
                "cells": _S(
                    type="ARRAY", items=_STR, description="Cell values, at most 10."
                ),
                "pointers": _S(
                    type="ARRAY",
                    items=_S(
                        type="OBJECT",
                        properties={"name": _STR, "index": _S(type="INTEGER")},
                        required=["name", "index"],
                    ),
                    description="Named pointers under cells, e.g. i, j, low, high, mid.",
                ),
            },
            required=["cells"],
        ),
        "chain": _S(
            type="OBJECT",
            description="ONLY for kind=chain: linked lists, stacks, queues, pipelines.",
            properties={
                "items": _S(type="ARRAY", items=_STR, description="At most 6 items."),
                "arrows": _S(
                    type="BOOLEAN",
                    description="Arrows between items (linked list, pipeline).",
                ),
                "vertical": _S(
                    type="BOOLEAN", description="Top-to-bottom (a stack, a call stack)."
                ),
            },
            required=["items"],
        ),
        "tree": _S(
            type="OBJECT",
            description="ONLY for kind=tree.",
            properties={
                "nodes": _S(
                    type="ARRAY",
                    items=_S(
                        type="OBJECT",
                        properties={"id": _STR, "label": _STR, "parent": _STR},
                        required=["id", "label"],
                    ),
                    description="At most 15 nodes; the root has no parent.",
                )
            },
            required=["nodes"],
        ),
        "diagram": DIAGRAM_SCHEMA,
        "list": _S(
            type="OBJECT",
            description="ONLY for kind=list: 2-5 short bullet points (key facts, causes, symptoms).",
            properties={"items": _S(type="ARRAY", items=_STR)},
            required=["items"],
        ),
        "table": _S(
            type="OBJECT",
            description="ONLY for kind=table.",
            properties={
                "headers": _STRS,
                "table_rows": _S(
                    type="ARRAY", items=_STRS, description="At most 8 rows."
                ),
            },
            required=["table_rows"],
        ),
    },
    required=["id", "kind"],
)

LESSON_SCHEMA = _S(
    type="OBJECT",
    properties={
        "title": _STR,
        "steps": _S(
            type="ARRAY",
            items=_S(
                type="OBJECT",
                properties={
                    "id": _STR,
                    "title": _S(
                        type="STRING",
                        description="Board heading for this step, under 40 characters.",
                    ),
                    "elements": _S(type="ARRAY", items=ELEMENT_SCHEMA),
                    "say": _S(
                        type="STRING",
                        description="What the teacher should get across while this step is drawn. 1-3 sentences, English.",
                    ),
                    "check": _S(
                        type="STRING",
                        description="One quick question to check understanding after this step.",
                    ),
                },
                required=["id", "title", "elements", "say"],
            ),
        ),
    },
    required=["title", "steps"],
)

PLANNER_PROMPT = """\
You plan whiteboard lessons for an expert teacher who explains out loud while
drawing — any subject: computer science, finance, medicine, physics, law,
economics, biology, history. You write the BOARD, not the lecture.

Topic: {topic}
Student: {level}
{focus}
Rules:
- 3 to 6 steps. Each step is one idea, and adds at most 3 elements.
- The board is written in English (technical terms stay English). The teacher
  speaks the explanation separately, so the board carries only what must be SEEN.
- Prefer concrete examples over definitions: a real array with real values, a
  real tree, real code. Show state changing across steps (e.g. the array after
  each pass), rather than describing it in text.
- kind=text for short headline facts only (under 60 characters). Never paragraphs.
- kind=code: at most 10 short lines, correct and runnable.
- kind=array: at most 10 cells; use pointers (i, j, low, high, mid, top) to show
  where the algorithm is looking.
- kind=chain for linked lists, stacks (vertical), queues, pipelines, and ANY
  system or process: client -> server -> DB, money flow, how a drug acts,
  cause -> effect.
- kind=tree for trees, heaps, recursion trees and any hierarchy or breakdown
  (org charts, taxonomies, a cost breakdown). At most 15 nodes.
- kind=table for DP tables, comparisons, numbers side by side (e.g. EMI at
  different rates, drug A vs B), complexity summaries.
- kind=code only for programming topics.
- EVERY lesson has at least one kind=diagram, designed for THIS subject:
    layers (OSI model, atmosphere, a software stack — first node on top),
    cycle (anything that loops), timeline (history, stages, versions),
    hub ("types of" / "parts of" — centre node first), compare ("X vs Y",
    each node has a group, exactly two groups), flow (processes, systems,
    cause -> effect). Every node gets an emoji icon and a colour; notes hold
    the one number or fact that matters. Add a `description` (1-2 sentences)
    and `bullets` (2-4 key facts) to each node for rich annotated infographics.
- kind=list for 2-5 key facts, causes, symptoms or rules.
- Element ids are unique across the whole lesson.
- Scientific labels, component names, numbers, steps, and annotations MUST be drawn using native board elements (kind=diagram, kind=chain, kind=tree, kind=table, kind=array). Generated images (kind=media) are strictly supplementary visual illustrations without embedded text labels.
- `say`: Exactly 2-3 sentences max. Must explicitly mention the exact labels and node names drawn in this step so spoken words match on-screen visual elements.
- `check`: One short, engaging check-in question testing understanding of this specific step. The teacher will ask this and PAUSE for the student's answer before continuing.
"""


class LessonPlanner:
    """Turns a topic into a board script with Gemini 3.8 Flash."""

    # Per-attempt ceiling. A healthy plan lands in 5-9s; past this, trying the
    # next model is faster than waiting.
    ATTEMPT_TIMEOUT_S = 14.0

    def __init__(self) -> None:
        # The SDK's own retry backs off for up to a minute on 503 — fine for a
        # batch job, fatal mid-class. Retrying is our job, across models.
        self._client = genai.Client(
            api_key=os.environ["GOOGLE_API_KEY"],
            http_options=types.HttpOptions(
                retry_options=types.HttpRetryOptions(attempts=1)
            ),
        )

    async def warm(self) -> None:
        """One tiny call so the first real lesson skips the TLS + auth setup."""
        try:
            await self._client.aio.models.generate_content(
                model=PLANNER_MODEL,
                contents="ok",
                config=types.GenerateContentConfig(max_output_tokens=1),
            )
        except Exception:
            logger.debug("planner warm-up failed", exc_info=True)

    async def plan(self, topic: str, level: str = "", focus: str = "") -> dict:
        t0 = time.perf_counter()
        prompt = PLANNER_PROMPT.format(
            topic=topic,
            level=level or "an Indian engineering undergraduate",
            focus=f"Focus on: {focus}\n" if focus else "",
        )
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=LESSON_SCHEMA,
            temperature=0.4,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
        )
        last: Exception | None = None
        for attempt, model in enumerate(PLANNER_FALLBACKS):
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(
                        model=model, contents=prompt, config=config
                    ),
                    timeout=self.ATTEMPT_TIMEOUT_S,
                )
                lesson = normalise_lesson(json.loads(resp.text or ""))
                if not lesson["steps"]:
                    raise ValueError("planner returned no steps")
            except (genai.errors.APIError, ValueError, TimeoutError) as exc:
                last = exc
                logger.warning(
                    "planner attempt %d (%s) failed: %s",
                    attempt + 1,
                    model,
                    str(exc)[:120] or type(exc).__name__,
                )
                await asyncio.sleep(0.3)
                continue
            logger.info(
                "lesson planned",
                extra={
                    "topic": topic,
                    "model": model,
                    "steps": len(lesson["steps"]),
                    "ms": round((time.perf_counter() - t0) * 1000),
                },
            )
            return lesson
        raise RuntimeError(f"could not plan a lesson: {last}")


def _slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "", s) or "el"


def _flatten_planner_shape(el: dict) -> dict:
    """Planner shape (`code: {code_lines}` ...) -> the renderer's flat shape."""
    code = el.pop("code", None) or {}
    arr = el.pop("array", None) or {}
    chain = el.pop("chain", None) or {}
    tree = el.pop("tree", None) or {}
    table = el.pop("table", None) or {}
    diagram = el.pop("diagram", None) or {}
    blist = el.pop("list", None) or {}
    k = el.get("kind")
    if k == "diagram":
        el.setdefault("nodes", diagram.get("nodes"))
        el.setdefault("edges", diagram.get("edges"))
        el.setdefault("layout", diagram.get("layout") or "flow")
        el.setdefault("diagram_type", diagram.get("diagram_type"))
        if diagram.get("title") and not el.get("label"):
            el["label"] = diagram["title"]
    elif k == "list":
        el.setdefault("items", blist.get("items"))
    if k == "code":
        el.setdefault("lines", code.get("code_lines"))
        el.setdefault("lang", code.get("lang"))
    elif k == "array":
        el.setdefault("values", arr.get("cells"))
        el.setdefault("pointers", arr.get("pointers"))
    elif k == "chain":
        el.setdefault("values", chain.get("items"))
        el.setdefault("arrows", chain.get("arrows"))
        el.setdefault("vertical", chain.get("vertical"))
    elif k == "tree":
        el.setdefault("nodes", tree.get("nodes"))
    elif k == "table":
        el.setdefault("headers", table.get("headers"))
        el.setdefault("rows", table.get("table_rows"))
    # A sub-object filed under the wrong kind still carries recoverable data.
    el.setdefault("lines", code.get("code_lines"))
    el.setdefault("values", arr.get("cells") or chain.get("items"))
    el.setdefault("rows", table.get("table_rows"))
    return el


def repair_element(el: dict) -> dict | None:
    """Fix the field mix-ups the planner makes, or drop the element.

    Models occasionally file data under a sibling kind's field — code lines
    as table rows, array cells as code lines. The intent is unambiguous, so
    move it rather than lose a whole step.
    """
    el = _flatten_planner_shape(el)
    k = el.get("kind")
    flat = lambda xs: [str(c) for r in xs for c in (r if isinstance(r, list) else [r])]  # noqa: E731

    if k == "code":
        lines = el.get("lines") or flat(el.get("rows") or []) or el.get("values")
        if not lines and el.get("text"):
            lines = str(el["text"]).splitlines()
        if not lines:
            return None
        el["lines"] = [str(x) for x in lines][:12]
    elif k in ("array", "chain"):
        vals = el.get("values") or el.get("lines") or flat(el.get("rows") or [])
        if not vals:
            return None
        el["values"] = [str(v) for v in vals][: 10 if k == "array" else 8]
        n = len(el["values"])
        el["pointers"] = [
            p
            for p in el.get("pointers") or []
            if isinstance(p.get("index"), int) and 0 <= p["index"] < n
        ]
    elif k == "text":
        if not el.get("text"):
            el["text"] = " ".join(el.get("lines") or el.get("values") or [])
        if not el["text"]:
            return None
    elif k == "tree":
        el["nodes"] = [
            n for n in el.get("nodes") or [] if n.get("id") and n.get("label")
        ][:15]
        if not el["nodes"]:
            return None
    elif k == "diagram":
        cleaned = clean_diagram({**el, "title": el.get("label")})
        if cleaned is None:
            return None
        el.update(cleaned)
    elif k == "list":
        items = [
            str(x)
            for x in el.get("items") or el.get("values") or el.get("lines") or []
            if str(x).strip()
        ]
        if not items:
            return None
        el["items"] = items[:6]
    elif k == "table":
        rows = [r for r in el.get("rows") or [] if isinstance(r, list)]
        if not rows:
            return None
        width = max(len(el.get("headers") or []), *(len(r) for r in rows))
        el["rows"] = [[str(c) for c in r] + [""] * (width - len(r)) for r in rows][:8]
        el["headers"] = [str(h) for h in (el.get("headers") or [])]
    # Drop fields that belong to other kinds so the browser gets a clean shape.
    keep = {
        "text": {"text"},
        "code": {"lines", "lang", "label"},
        "array": {"values", "pointers", "label"},
        "chain": {"values", "arrows", "vertical", "label"},
        "tree": {"nodes", "label"},
        "table": {"headers", "rows", "label"},
        "diagram": {"nodes", "edges", "layout", "diagramType", "label"},
        "list": {"items", "label"},
    }[k]
    return {
        "id": el.get("id"),
        "kind": k,
        **{f: el[f] for f in keep if el.get(f) is not None},
    }


def normalise_lesson(raw: dict) -> dict:
    """Make ids unique and drop anything the renderer cannot draw.

    The planner is good but not perfect; a duplicate id would make two things
    answer to the same student mark, and an unknown kind would crash nothing but
    silently draw nothing. Fix both here rather than trusting the model.
    """
    seen: set[str] = set()

    def unique(base: str) -> str:
        base = _slug(base)
        cand, n = base, 2
        while cand in seen:
            cand, n = f"{base}{n}", n + 1
        seen.add(cand)
        return cand

    steps = []
    for si, step in enumerate(raw.get("steps") or []):
        elements = []
        for el in step.get("elements") or []:
            if el.get("kind") not in KINDS:
                continue
            el = repair_element(dict(el))
            if el is None:
                continue
            el["id"] = unique(el.get("id") or el["kind"])
            elements.append(el)
        steps.append(
            {
                "id": unique(step.get("id") or f"s{si + 1}"),
                "title": step.get("title", ""),
                "elements": elements[:4],
                "say": step.get("say", ""),
                "check": step.get("check", ""),
            }
        )
    return {"title": raw.get("title", ""), "steps": steps[:6]}


# --- Describing things on the board in words -----------------------------------


def _describe_element(el: dict) -> str:
    k = el["kind"]
    label = f" '{el['label']}'" if el.get("label") else ""
    if k == "text":
        return f'the note "{el.get("text", "")}"'
    if k == "code":
        return f"the {el.get('lang') or ''} code{label}".replace("  ", " ")
    if k == "array":
        return f"the array{label} [{', '.join(el.get('values') or [])}]"
    if k == "chain":
        return f"the {'stack' if el.get('vertical') else 'chain'}{label} {' -> '.join(el.get('values') or [])}"
    if k == "tree":
        return f"the tree{label}"
    if k == "table":
        return f"the table{label} ({', '.join(el.get('headers') or [])})"
    if k == "diagram":
        return f"the {el.get('layout', 'flow')} diagram{label} of " + ", ".join(
            n["label"] for n in el.get("nodes") or []
        )
    if k == "list":
        return f"the list{label}: " + "; ".join(el.get("items") or [])
    if k == "media":
        return (
            f"the generated {el.get('media', 'image')}{label}: {el.get('caption', '')}"
        )
    return k


def describe_target(el: dict, sub: str | None) -> str:
    """Words for one target address, precise enough to explain from."""
    base = _describe_element(el)
    if sub is None:
        return base
    k = el["kind"]
    try:
        if k == "code":
            i = int(sub)
            return f"line {i + 1} of {base}: `{(el.get('lines') or [])[i].strip()}`"
        if k in ("array", "chain"):
            i = int(sub)
            vals = el.get("values") or []
            what = "cell" if k == "array" else "item"
            ptrs = [p["name"] for p in el.get("pointers") or [] if p.get("index") == i]
            at = f" (where {', '.join(ptrs)} points)" if ptrs else ""
            return f"{what} {i} of {base}, value {vals[i]}{at}"
        if k == "table":
            r, c = (int(x) for x in sub.split("."))
            head = (
                (el.get("headers") or [])[c]
                if c < len(el.get("headers") or [])
                else f"col {c}"
            )
            return f"row {r + 1}, column '{head}' of {base}: {el['rows'][r][c]}"
        if k == "list":
            return (
                f"point {int(sub) + 1} of {base}: {(el.get('items') or [])[int(sub)]}"
            )
        if k in ("tree", "diagram"):
            node = next((n for n in el.get("nodes") or [] if n["id"] == sub), None)
            if node:
                return f"node '{node['label']}' of {base}"
    except (ValueError, IndexError, KeyError, TypeError):
        pass
    return base


# --- Board state -----------------------------------------------------------------


class Page:
    """One whiteboard. Old pages stay intact when a new one is started."""

    def __init__(self, page_id: str, title: str) -> None:
        self.id = page_id
        self.title = title
        self.lesson: dict | None = None
        self.revealed = 0  # number of lesson steps shown so far
        self.elements: dict[str, dict] = {}  # every drawable element by id
        self.pending: asyncio.Task[dict] | None = None  # a lesson being planned
        self.latest_concept_id: str = ""

    @property
    def empty(self) -> bool:
        return not self.elements and self.pending is None and self.lesson is None


class Board:
    """The student's boards, and the pipe to draw on them.

    Several pages, like tabs: starting a new topic opens a fresh page and the
    old one stays, so the student (or another agent) can go back to it. Every
    op carries its page id; everything below acts on the CURRENT page, which
    follows whichever page the student last looked at.
    """

    def __init__(self, room: rtc.Room | None = None) -> None:
        self._room = room
        self.pages: list[Page] = [Page("b1", "Board 1")]
        self.current = self.pages[0]
        self._improvised = 0
        self.checkpoints: dict[str, dict[str, Any]] = {}
        # Per-session tag, so things drawn in a continued chat never reuse the
        # ids of things drawn the first time round.
        self._tag = os.urandom(2).hex()

    # Current-page shorthands, so tools read naturally.
    @property
    def lesson(self) -> dict | None:
        return self.current.lesson

    @property
    def revealed(self) -> int:
        return self.current.revealed

    @property
    def elements(self) -> dict[str, dict]:
        return self.current.elements

    @property
    def pending(self) -> asyncio.Task[dict] | None:
        return self.current.pending

    @pending.setter
    def pending(self, task: asyncio.Task[dict] | None) -> None:
        self.current.pending = task

    async def publish(self, op: dict[str, Any], page: Page | None = None) -> None:
        op = {**op, "board": (page or self.current).id}
        if self._room and getattr(self._room, "local_participant", None):
            await self._room.local_participant.publish_data(
                json.dumps(op, ensure_ascii=False), reliable=True, topic=BOARD_TOPIC
            )

    # -- pages

    def find(self, page_id: str) -> Page | None:
        return next((p for p in self.pages if p.id == page_id), None)

    async def new_page(
        self, title: str = "", page_id: str | None = None, announce: bool = True
    ) -> Page:
        """Open a fresh board; the old ones are kept. Reuses the current one if blank."""
        if self.current.empty and page_id is None:
            if title:
                self.current.title = title
                await self.publish({"op": "board_new", "title": title})
            return self.current
        page = Page(
            page_id or f"b{len(self.pages) + 1}",
            title or f"Board {len(self.pages) + 1}",
        )
        self.pages.append(page)
        self.current = page
        if announce:
            await self.publish({"op": "board_new", "title": page.title})
        return page

    def restore(self, book: dict) -> None:
        """Rebuild the pages of a chat being continued, from the browser's copy,
        so the teacher can point at what is already drawn."""
        pages: list[Page] = []
        for pid in book.get("order") or []:
            p = (book.get("pages") or {}).get(pid) or {}
            page = Page(str(pid), str(p.get("title") or pid))
            steps = p.get("steps") or []
            page.revealed = int(p.get("revealed") or 0)
            if steps:
                page.lesson = {"title": page.title, "steps": steps}
            for step in steps[: page.revealed]:
                for el in step.get("elements") or []:
                    if el.get("id"):
                        page.elements[el["id"]] = el
            for image in p.get("images") or []:
                el = image.get("element") or {}
                if el.get("id") and el.get("kind") == "media":
                    page.elements[el["id"]] = el
            pages.append(page)
        if pages:
            self.pages = pages
            active = book.get("active")
            self.current = next((p for p in pages if p.id == active), pages[-1])

    async def open_page(self, page: Page, announce: bool = True) -> None:
        self.current = page
        if announce:
            await self.publish({"op": "board_open"})

    def page_list(self) -> str:
        return "\n".join(
            f"{i + 1}. {p.title}{' (on screen now)' if p is self.current else ''}"
            f" — {len(p.elements)} things drawn"
            for i, p in enumerate(self.pages)
        )

    # -- lessons

    async def load_lesson(self, lesson: dict, page: Page | None = None) -> None:
        page = page or self.current
        page.lesson = lesson
        page.revealed = 0
        page.elements = {key: el for key, el in page.elements.items() if el.get("kind") == "media"}
        if lesson.get("title"):
            page.title = lesson["title"]
        await self.publish({"op": "lesson", "lesson": lesson}, page)

    async def reveal(self, n: int) -> dict | None:
        """Draw step n (1-based) on the current page, or None if there is none."""
        page = self.current
        if not page.lesson or not (1 <= n <= len(page.lesson["steps"])):
            return None
        step = page.lesson["steps"][n - 1]
        for el in step["elements"]:
            page.elements[el["id"]] = el
        page.revealed = max(page.revealed, n)
        await self.publish({"op": "reveal", "step": n})
        return step

    async def checkpoint(
        self,
        concept_id: str = "",
        question: str = "",
        checkpoint_id: str = "",
        page: Page | None = None,
        speech_id: str = "",
        options: list[dict[str, str]] | list[str] | None = None,
        hints: list[str] | None = None,
        criteria: str = "",
        answer_key: str = "",
    ) -> dict[str, Any]:
        """Publish an explicit checkpoint activation event for a concept."""
        p = page or self.current
        cid = (
            concept_id
            or getattr(p, "latest_concept_id", "")
            or (f"s{p.revealed}" if getattr(p, "revealed", 0) > 0 else "concept-default")
        )
        cp_id = checkpoint_id or f"cp-{cid}"

        # Normalize options with stable IDs
        norm_options: list[dict[str, str]] = []
        if options:
            for i, opt in enumerate(options):
                if isinstance(opt, dict):
                    opt_id = str(opt.get("id") or f"opt-{i}")
                    opt_text = str(opt.get("text") or "")
                    norm_options.append({"id": opt_id, "text": opt_text})
                else:
                    norm_options.append({"id": f"opt-{i}", "text": str(opt)})

        op: dict[str, Any] = {
            "op": "checkpoint",
            "id": cp_id,
            "conceptId": cid,
            "question": question,
            "speechId": speech_id,
            "at": int(time.time() * 1000),
        }
        if norm_options:
            op["options"] = norm_options
        if hints:
            op["hints"] = list(hints)
        if criteria:
            op["criteria"] = str(criteria)
        if answer_key:
            op["answerKey"] = str(answer_key)

        # Store checkpoint metadata for answer evaluation
        self.checkpoints[cp_id] = {
            "id": cp_id,
            "conceptId": cid,
            "question": question,
            "speechId": speech_id,
            "options": norm_options,
            "hints": list(hints) if hints else [],
            "criteria": str(criteria) if criteria else "",
            "answerKey": str(answer_key) if answer_key else "",
            "page": p,
        }

        await self.publish(op, p)
        return op

    def evaluate_answer(
        self, cp_id: str, response: str, option_id: str = ""
    ) -> tuple[bool | None, str]:
        """Evaluate a learner's answer against checkpoint options, answer key, or criteria.
        Returns (True/False/None, feedback). None indicates evaluation is pending (ungraded or unknown)."""
        cp = self.checkpoints.get(cp_id)
        resp_clean = response.strip()
        if not resp_clean and not option_id:
            return False, "No answer provided."

        if not cp:
            return None, "Answer received. Acharya will review."

        answer_key = cp.get("answerKey", "").strip()
        options = cp.get("options") or []
        criteria = cp.get("criteria", "").strip()

        # 1. Option ID / Answer Key matching for chip responses
        if option_id:
            if answer_key:
                is_correct = (option_id.lower() == answer_key.lower()) or (
                    resp_clean.lower() == answer_key.lower()
                )
                return (
                    is_correct,
                    "Correct! Excellent choice." if is_correct else "Not quite the right option.",
                )
            for opt in options:
                if isinstance(opt, dict) and opt.get("id") == option_id:
                    if "correct" in opt:
                        is_correct = bool(opt["correct"])
                        return is_correct, "Correct!" if is_correct else "Not quite. Try again!"
            return None, "Option selected. Acharya will review."

        # 2. Explicit criteria evaluation with negation check
        if criteria:
            crit_lower = criteria.lower()
            resp_lower = resp_clean.lower()
            parts = [p.strip() for p in re.split(r"[,;|]|\bor\b", crit_lower) if p.strip()]
            negation_pattern = re.compile(
                r"\b(not|no|never|neither|nor|without|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|don't|dont|doesn't|doesnt|didn't|didnt|won't|wont|cannot|can't|cant)\b",
                re.IGNORECASE,
            )
            contrast_pattern = re.compile(
                r"[;:.!?—]|\s--\s|\b(but|instead|rather|whereas|while|however|although|though)\b",
                re.IGNORECASE,
            )

            for part in parts:
                idx = resp_lower.find(part)
                if idx != -1:
                    lookback = resp_lower[max(0, idx - 45) : idx]
                    matches = list(negation_pattern.finditer(lookback))
                    if matches:
                        last_match = matches[-1]
                        between = lookback[last_match.end() :]
                        is_contrast = bool(
                            contrast_pattern.search(between)
                            or re.search(r"\w+\s*,", between)
                            or re.fullmatch(r"\s*,\s*", between)
                        )
                        if not is_contrast:
                            return False, "Your answer negates the expected concept. Check the hint or try again!"
                    return True, "Correct! Excellent explanation."
            return False, "Not quite. Check the hint or try again!"

        # 3. Options present without explicit criteria:
        if options:
            opt_texts = [
                (o.get("text", "") if isinstance(o, dict) else str(o)).lower()
                for o in options
            ]
            opt_ids = [
                (o.get("id", "") if isinstance(o, dict) else "").lower()
                for o in options
            ]

            # Check if answer matches ANY valid option
            if resp_clean.lower() not in opt_texts and resp_clean.lower() not in opt_ids:
                return False, "Answer does not match any available option. Check the hint or try again!"

            if answer_key:
                is_correct = (
                    resp_clean.lower() == answer_key.lower()
                    or resp_clean.lower() in [o.get("text", "").lower() for o in options if o.get("id", "").lower() == answer_key.lower()]
                )
                return is_correct, "Correct! Excellent answer." if is_correct else "Not quite. Check the hint or try again!"

            return None, "Answer received. Acharya will review."

        return None, "Answer received. Acharya will review."

    # -- improvisation

    def new_id(self, kind: str) -> str:
        self._improvised += 1
        return f"x{self._tag}{kind[:3]}{self._improvised}"

    async def add(self, el: dict, after: str | None = None, page: Page | None = None) -> None:
        """Draw an improvised element, placed after `after` if it is on the board."""
        page = page or self.current
        parent_cid: str | None = None
        if after:
            anchor_id = after.split("#")[0]
            parent_el = page.elements.get(anchor_id)
            if parent_el:
                parent_cid = parent_el.get("conceptId")

        if not parent_cid and getattr(page, "latest_concept_id", None):
            kind = el.get("kind", "")
            if kind in ("text", "note", "media", "image"):
                parent_cid = page.latest_concept_id

        if el.get("conceptId"):
            cid = el["conceptId"]
            page.latest_concept_id = cid
        elif parent_cid:
            cid = parent_cid
            el["conceptId"] = cid
        else:
            cid = f"concept-{el['id']}"
            el["conceptId"] = cid
            page.latest_concept_id = cid

        page.elements[el["id"]] = el
        op: dict[str, Any] = {"op": "add", "element": el, "conceptId": cid}
        if after and after.split("#")[0] in page.elements:
            op["after"] = after
        await self.publish(op, page)

    async def update_array(
        self, el_id: str, values: list[str] | None, pointers: list[dict] | None
    ) -> bool:
        el = self.elements.get(el_id)
        if not el or el["kind"] != "array":
            return False
        if values is not None:
            el["values"] = values
        if pointers is not None:
            el["pointers"] = pointers
        await self.publish(
            {
                "op": "array",
                "id": el_id,
                "values": el.get("values"),
                "pointers": el.get("pointers"),
            }
        )
        return True

    async def clear(self) -> None:
        """Wipe the current page only."""
        page = self.current
        page.lesson = None
        page.revealed = 0
        page.elements = {}
        await self.publish({"op": "clear"})

    # -- addressing

    def split_target(self, target: str) -> tuple[dict, str | None] | None:
        target = target.strip().strip("`'\"")
        el_id, _, sub = target.partition("#")
        el = self.elements.get(el_id)
        if el is None:
            return None
        return el, (sub or None)

    def describe(self, target: str) -> str | None:
        found = self.split_target(target)
        if not found:
            return None
        return describe_target(*found)

    def inventory(self) -> str:
        """Everything on the current page with its address, for the Live model."""
        lines = [f"Board '{self.current.title}':"]
        for el_id, el in self.elements.items():
            k = el["kind"]
            extra = ""
            if k == "code":
                extra = " lines: " + " | ".join(
                    f"#{i} {ln.strip()}" for i, ln in enumerate(el.get("lines") or [])
                )
            elif k in ("array", "chain"):
                extra = " cells: " + ", ".join(
                    f"#{i}={v}" for i, v in enumerate(el.get("values") or [])
                )
            elif k == "tree":
                extra = " nodes: " + ", ".join(
                    f"#{n['id']}={n['label']}" for n in el.get("nodes") or []
                )
            lines.append(f"- {el_id}: {_describe_element(el)}{extra}")
        if len(lines) == 1:
            lines.append("(nothing drawn yet)")
        return "\n".join(lines)
