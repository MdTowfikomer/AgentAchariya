"""Day 8: did the call actually work?

SUCCESS, for this agent, means the student walked away with something concrete.
Taken straight from the Day 2 objectives, narrowed until it is measurable:

    a concept was taught   -- code or a flowchart went on their screen
    a problem was given    -- a real Codeforces exercise to attempt
    a human was found      -- an escalation was filed for them

Any one of those and the call succeeded. A warm chat where nothing was learned
did not.

Deciding this in CODE rather than asking the model to grade itself matters. A
model asked "did that go well?" says yes almost every time, and a dashboard
built on that flatters you instead of informing you. These three signals are
side effects of tools actually firing, so they cannot be talked into existence.

A failed call is not a crash. Usually it means the student left before getting
anywhere, which is worth knowing.

Privacy: no transcript, no phone number, no content of any kind. Counters,
timings and an outcome. Nothing here would embarrass a student if it leaked.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from memory import _call, _ensure_pool

logger = logging.getLogger("agent.analytics")

SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
    id               TEXT PRIMARY KEY,
    channel          TEXT NOT NULL,
    student          TEXT,
    language         TEXT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    duration_s       INTEGER,
    outcome          TEXT,
    failure_type     TEXT,
    concepts_taught  INTEGER NOT NULL DEFAULT 0,
    problems_given   INTEGER NOT NULL DEFAULT 0,
    escalations      INTEGER NOT NULL DEFAULT 0,
    turns            INTEGER NOT NULL DEFAULT 0,
    tool_errors      INTEGER NOT NULL DEFAULT 0,
    first_reply_ms   INTEGER
);
"""

FAILURE_TYPES = {
    "no_engagement": "joined but never asked anything",
    "incomplete": "talked, but never got to a concept or exercise",
    "tool_failure": "a tool broke mid-call",
}


def judge(stats: dict[str, int]) -> tuple[str, str | None]:
    """Decide the outcome from what actually happened. No model involved."""
    delivered = (
        stats.get("concepts_taught", 0)
        + stats.get("problems_given", 0)
        + stats.get("escalations", 0)
    )
    if delivered > 0:
        return "success", None
    if stats.get("tool_errors", 0) > 0:
        return "failed", "tool_failure"
    if stats.get("turns", 0) == 0:
        return "failed", "no_engagement"
    return "failed", "incomplete"


# --- implementations, on the database loop -----------------------------------


async def _ensure_table() -> None:
    pool = await _ensure_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(SCHEMA)


async def _start(call_id: str, channel: str, language: str | None) -> None:
    await _ensure_table()
    pool = await _ensure_pool()
    if pool is None:
        return
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO calls (id, channel, language) VALUES ($1,$2,$3) "
            "ON CONFLICT (id) DO NOTHING",
            call_id,
            channel,
            language,
        )


async def _finish(
    call_id: str, student: str | None, stats: dict[str, int], started: datetime
) -> dict[str, Any]:
    outcome, failure_type = judge(stats)
    duration = int((datetime.now(timezone.utc) - started).total_seconds())

    await _ensure_table()
    pool = await _ensure_pool()
    if pool is None:
        logger.info(
            "call finished (no db)",
            extra={"outcome": outcome, "failure": failure_type, "secs": duration},
        )
        return {"outcome": outcome, "failure_type": failure_type, "duration_s": duration}

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE calls SET student=$1, ended_at=now(), duration_s=$2, outcome=$3, "
            "failure_type=$4, concepts_taught=$5, problems_given=$6, escalations=$7, "
            "turns=$8, tool_errors=$9, first_reply_ms=$10 WHERE id=$11",
            student,
            duration,
            outcome,
            failure_type,
            stats.get("concepts_taught", 0),
            stats.get("problems_given", 0),
            stats.get("escalations", 0),
            stats.get("turns", 0),
            stats.get("tool_errors", 0),
            stats.get("first_reply_ms") or None,
            call_id,
        )
    logger.info(
        "call finished",
        extra={"outcome": outcome, "failure": failure_type, "secs": duration},
    )
    return {"outcome": outcome, "failure_type": failure_type, "duration_s": duration}


# --- public API --------------------------------------------------------------


async def start_call(call_id: str, channel: str, language: str | None = None) -> None:
    """Open a row the moment the agent joins, so abandoned calls are counted too."""
    await _call(_start(call_id, channel, language))


async def finish_call(
    call_id: str, student: str | None, stats: dict[str, int], started: datetime
) -> dict[str, Any]:
    """Close the row and decide the outcome."""
    return await _call(_finish(call_id, student, stats, started))
