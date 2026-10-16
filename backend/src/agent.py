"""Agent Acharya — entry point.

Every session is a live whiteboard class (board_session.py): Gemini 3.8 Live
talks and listens, Gemini 3.8 Flash plans lessons, directs visuals and
researches, and Nano Banana draws. This file only registers the worker.
"""

import logging

from dotenv import load_dotenv
from livekit.agents import AgentServer, JobContext, JobProcess, cli

from board import LessonPlanner
from board_session import run_board_session
from config import validate_environment
from locale_map import DEFAULT_PROFILE

logger = logging.getLogger("agent")

load_dotenv(".env.local")
validate_environment()

server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    # One planner per process. It is warmed at the start of each class rather
    # than here: its async HTTP client binds to the event loop it first runs
    # on, and this setup hook's loop is not the job's.
    proc.userdata["planner"] = LessonPlanner()


server.setup_fnc = prewarm


# The agent name is what the web app's token route dispatches to (AGENT_NAME).
@server.rtc_session(agent_name="nova-te")
async def my_agent(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}
    planner = ctx.proc.userdata.get("planner") or LessonPlanner()
    await run_board_session(ctx, DEFAULT_PROFILE, planner)


if __name__ == "__main__":
    cli.run_app(server)
