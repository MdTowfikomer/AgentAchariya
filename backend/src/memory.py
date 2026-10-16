"""Day 4: memory that survives a restart.

One table, one row per student. The agent reaches this only through tools —
never through the prompt — so what it remembers is auditable and can be deleted
on request.

Track: Learning & Literacy, so the facts worth keeping are the ones that change
how you teach someone next time:

    level            -- beginner / intermediate / advanced, in their words
    topics_covered   -- what we have already been through
    weak_spots       -- mistakes they keep repeating (the most useful of all)
    language         -- which language they prefer to be taught in

Deliberately NOT stored: anything that is not about learning. No phone number,
no school, no address, no marks. A CS tutor has no business holding those.

THREADING NOTE — this is the whole reason for the structure below.

asyncpg resolves hostnames via `loop.getaddrinfo`, which runs on the event
loop's DEFAULT executor. LiveKit shuts that executor down during a job, so any
connection opened afterwards dies with "Executor shutdown has been called".

Replacing the loop's default executor looks like the fix. It is not: LiveKit's
own Deepgram STT and aiohttp share that executor, so substituting ours made the
microphone fail mid-call with "cannot schedule new futures after shutdown" and
killed the session unrecoverably.

So the database runs on its own event loop, on its own daemon thread. Its
executor belongs to us, nothing else uses it, and LiveKit's lifecycle cannot
reach it. The agent awaits results across the thread boundary as normal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any

import asyncpg

logger = logging.getLogger("agent.memory")

_pool: asyncpg.Pool | None = None
_loop: asyncio.AbstractEventLoop | None = None
_thread: threading.Thread | None = None
_start_lock = threading.Lock()


SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    user_id             TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    language_preference TEXT,
    facts               JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_interaction    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def slugify(name: str) -> str:
    """Turn a spoken name into a stable key.

    Speech-to-text spells names inconsistently, so we normalise hard: lowercase,
    strip punctuation, collapse whitespace. "Ravi Kumar", "ravi  kumar" and
    "Ravi, Kumar" all land on the same row.
    """
    cleaned = re.sub(r"[^\w\s]", "", name, flags=re.UNICODE).strip().lower()
    return re.sub(r"\s+", "-", cleaned)


# --- the private database loop ----------------------------------------------


def _db_loop() -> asyncio.AbstractEventLoop:
    """Return the database's own event loop, starting its thread if needed."""
    global _loop, _thread
    with _start_lock:
        if _loop is not None:
            return _loop

        loop = asyncio.new_event_loop()

        def _run() -> None:
            asyncio.set_event_loop(loop)
            loop.run_forever()

        _thread = threading.Thread(target=_run, daemon=True, name="nova-db-loop")
        _thread.start()
        _loop = loop
        return loop


async def _call(coro: Any) -> Any:
    """Run a coroutine on the database loop, awaited from the agent's loop."""
    future = asyncio.run_coroutine_threadsafe(coro, _db_loop())
    return await asyncio.wrap_future(future)


# --- implementations, all running on the database loop -----------------------


async def _ensure_pool() -> asyncpg.Pool | None:
    global _pool
    if _pool is not None and not _pool.is_closing():
        return _pool

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        return None

    # asyncpg speaks SSL natively and rejects libpq-style query params that the
    # Neon console hands out, so strip them and ask for TLS directly.
    dsn = re.sub(r"[?&](sslmode|channel_binding)=[^&]*", "", dsn)

    try:
        _pool = await asyncpg.create_pool(
            dsn,
            ssl="require",
            min_size=1,
            max_size=2,
            # Neon's pooler drops idle connections; let asyncpg replace them rather
            # than hand us a dead socket.
            max_inactive_connection_lifetime=180.0,
        )
        async with _pool.acquire() as conn:
            await conn.execute(SCHEMA)
        logger.info("memory ready")
        return _pool
    except Exception as exc:
        logger.warning("Postgres pool creation failed (%s); persistent memory disabled", exc)
        return None


async def _recall(name: str) -> dict[str, Any] | None:
    pool = await _ensure_pool()
    if pool is None:
        return None
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT user_id, name, language_preference, facts, last_interaction "
            "FROM students WHERE user_id = $1",
            slugify(name),
        )
    if row is None:
        return None

    facts = row["facts"]
    return {
        "user_id": row["user_id"],
        "name": row["name"],
        "language_preference": row["language_preference"],
        "facts": json.loads(facts) if isinstance(facts, str) else dict(facts or {}),
        "last_interaction": row["last_interaction"].isoformat(),
    }


async def _remember(
    name: str,
    facts: dict[str, Any] | None,
    language_preference: str | None,
) -> dict[str, Any] | None:
    pool = await _ensure_pool()
    if pool is None:
        return None
    user_id = slugify(name)

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO students (user_id, name, language_preference, facts, last_interaction)
            VALUES ($1, $2, $3, $4::jsonb, $5)
            ON CONFLICT (user_id) DO UPDATE SET
                name = EXCLUDED.name,
                language_preference =
                    COALESCE(EXCLUDED.language_preference, students.language_preference),
                facts = students.facts || EXCLUDED.facts,
                last_interaction = EXCLUDED.last_interaction
            """,
            user_id,
            name.strip(),
            language_preference,
            json.dumps(facts or {}, ensure_ascii=False),
            datetime.now(timezone.utc),
        )

    logger.info("remembered", extra={"user_id": user_id})
    return await _recall(name)


async def _forget(name: str) -> bool:
    pool = await _ensure_pool()
    if pool is None:
        return False
    async with pool.acquire() as conn:
        status = await conn.execute(
            "DELETE FROM students WHERE user_id = $1", slugify(name)
        )
    removed = status.endswith("1")
    logger.info("forget", extra={"user_id": slugify(name), "removed": removed})
    return removed


async def _close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# --- public API, called from the agent's loop --------------------------------


async def init() -> None:
    """Open the pool ahead of the first lookup. Safe to call repeatedly."""
    await _call(_ensure_pool())


async def recall(name: str) -> dict[str, Any] | None:
    """Look a student up by name. None if we have never met them."""
    return await _call(_recall(name))


async def remember(
    name: str,
    facts: dict[str, Any] | None = None,
    language_preference: str | None = None,
) -> dict[str, Any] | None:
    """Create or update a student's record.

    Facts merge rather than replace, so saving one new weak spot does not wipe
    the topics we covered last month.
    """
    return await _call(_remember(name, facts, language_preference))


async def forget(name: str) -> bool:
    """Delete a student's record entirely. True if a row was removed."""
    return await _call(_forget(name))


async def close() -> None:
    await _call(_close())
