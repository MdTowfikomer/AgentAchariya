"""Room presence must not depend on optional persistence being reachable."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import board_session


@pytest.mark.asyncio
async def test_room_join_happens_before_database_startup(monkeypatch):
    class StopAfterJoin(Exception):
        pass

    init = AsyncMock()
    monkeypatch.setattr(board_session.memory, "init", init)
    ctx = SimpleNamespace(connect=AsyncMock(side_effect=StopAfterJoin))

    with pytest.raises(StopAfterJoin):
        await board_session.run_board_session(ctx, None, None)

    ctx.connect.assert_awaited_once()
    init.assert_not_awaited()
