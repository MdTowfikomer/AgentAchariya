"""Environment and configuration validation for Telugu-Nova backend."""

from __future__ import annotations

import logging
import os
import sys

logger = logging.getLogger("agent.config")

REQUIRED_ENV_VARS = [
    ("GOOGLE_API_KEY", "Google Gemini API key running real-time voice, vision & reasoning."),
]

RECOMMENDED_ENV_VARS = [
    ("CLOUDFLARE_ACCOUNT_ID", "Cloudflare account ID for optional topic images."),
    ("CLOUDFLARE_API_TOKEN", "Workers AI token for optional topic images."),
    ("SERPAPI_API_KEY", "SerpApi API key required for source-backed live research."),
    ("LIVEKIT_URL", "LiveKit Server WebSocket URL (e.g. wss://your-project.livekit.cloud)."),
    ("LIVEKIT_API_KEY", "LiveKit API Key."),
    ("LIVEKIT_API_SECRET", "LiveKit API Secret."),
    ("DATABASE_URL", "Neon Serverless Postgres URL for persistent student memory & call analytics."),
]


def validate_environment() -> None:
    """Validate environment variables and issue clear startup diagnostics."""
    missing_required = []
    for var, desc in REQUIRED_ENV_VARS:
        if not os.environ.get(var, "").strip():
            missing_required.append((var, desc))

    if missing_required:
        logger.error("=" * 60)
        logger.error("MISSING CRITICAL CONFIGURATION:")
        for var, desc in missing_required:
            logger.error("  - %s: %s", var, desc)
        logger.error("Please add missing variables to backend/.env.local and restart.")
        logger.error("=" * 60)

    missing_recommended = []
    for var, desc in RECOMMENDED_ENV_VARS:
        if not os.environ.get(var, "").strip():
            missing_recommended.append((var, desc))

    if missing_recommended:
        for var, desc in missing_recommended:
            logger.info("Optional setting [%s] is not set (%s).", var, desc)
