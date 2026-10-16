"""Semantic SVG resolver used by the visual director.

Resolution is intentionally predictable: curated local teaching assets first,
then line-icon catalogues exposed through Iconify, a small composition for
relationships that one icon cannot explain, and Gemini only as a last resort.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from google import genai
from google.genai import types

logger = logging.getLogger("agent.illustrations")
ASSET_DIR = Path(__file__).parent / "assets" / "svg"
ICONIFY_SEARCH = "https://api.iconify.design/search?query={q}&limit=12"
ICONIFY_SVG = "https://api.iconify.design/{prefix}/{name}.svg?height=200"
# Tabler and Lucide are first because they match the board's light line-art.
PREFERRED_SETS = ("tabler", "lucide", "ph", "mdi", "ri", "fluent", "solar")
LOCAL_ASSETS = {
    "photosynthesis": "photosynthesis.svg", "chloroplast": "photosynthesis.svg", "plant": "photosynthesis.svg",
    "heart anatomy": "heart.svg", "left ventricle": "heart.svg", "heart": "heart.svg",
    "scientific method": "microscope.svg", "microscope": "microscope.svg",
    "car engine": "engine.svg", "engine": "engine.svg",
}

GEMINI_SVG_PROMPT = """\
Generate a simple, clean SVG illustration of: {query}

Output ONLY one valid <svg viewBox="0 0 200 200">. Use paths, circles,
rectangles, ellipses, lines and polygons only. No text, scripts, images, or
gradients. Use #2B3A55 thin strokes and restrained pastel fills. It must
explain the named object, not decorate a page.
"""


def _normalise(query: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", query.lower()).strip()


def _compose_svg(query: str) -> str | None:
    """Relationship drawings for topics where one icon is misleading."""
    q = _normalise(query)
    ink, blue, green, orange = "#2B3A55", "#DCEBFA", "#DDF4E4", "#FCE3D2"
    base = f'<svg viewBox="0 0 200 200" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
    if "computer network" in q or q == "network":
        return base + f'<path d="M45 55L100 100 155 55M45 145L100 100 155 145"/><rect x="78" y="78" width="44" height="44" rx="10" fill="{blue}"/><circle cx="45" cy="55" r="18" fill="{green}"/><circle cx="155" cy="55" r="18" fill="{green}"/><circle cx="45" cy="145" r="18" fill="{orange}"/><circle cx="155" cy="145" r="18" fill="{orange}"/></svg>'
    if "binary search" in q:
        cells = ''.join(f'<rect x="{25+i*25}" y="82" width="22" height="36" rx="5" fill="{blue if i == 3 else green}"/>' for i in range(6))
        return base + f'<path d="M25 100H175"/>{cells}<path d="M100 55v22m-10-10 10 10 10-10"/></svg>'
    if "machine learning" in q or "neural network" in q:
        return base + f'<path d="M45 50L100 75 155 50M45 100L100 75 155 100M45 150L100 125 155 150M100 75V125"/><circle cx="45" cy="50" r="13" fill="{blue}"/><circle cx="45" cy="100" r="13" fill="{blue}"/><circle cx="45" cy="150" r="13" fill="{blue}"/><circle cx="100" cy="75" r="13" fill="{green}"/><circle cx="100" cy="125" r="13" fill="{green}"/><circle cx="155" cy="50" r="13" fill="{orange}"/><circle cx="155" cy="100" r="13" fill="{orange}"/><circle cx="155" cy="150" r="13" fill="{orange}"/></svg>'
    return None


@dataclass(frozen=True)
class ResolvedIllustration:
    svg: str
    parts: list[dict]


def _iot_composition(query: str) -> ResolvedIllustration | None:
    """A compact, targetable teaching visual — not four unrelated icons."""
    if not any(term in _normalise(query) for term in ("iot", "internet of things")):
        return None
    ink = "#2B3A55"
    svg = f'''<svg viewBox="0 0 400 200" fill="none" stroke="{ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <defs><marker id="iot-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4 0 8" fill="{ink}" stroke="none"/></marker></defs>
      <path d="M82 100H128M202 100H248M322 100H358" marker-end="url(#iot-arrow)"/>
      <g id="sensor"><rect x="18" y="65" width="64" height="70" rx="14" fill="#DDF4E4"/><circle cx="50" cy="92" r="12"/><path d="M34 116h32"/><text x="50" y="155" text-anchor="middle" fill="{ink}" stroke="none" font-size="13" font-family="sans-serif">Sensors</text></g>
      <g id="microcontroller"><rect x="128" y="57" width="74" height="86" rx="12" fill="#DCEBFA"/><rect x="148" y="78" width="34" height="36" rx="5"/><path d="M140 68v-12m16 12v-12m16 12v-12m-32 87v12m16-12v12m16-12v12"/><text x="165" y="175" text-anchor="middle" fill="{ink}" stroke="none" font-size="13" font-family="sans-serif">Controller</text></g>
      <g id="cloud"><path d="M260 120h54c16 0 23-20 10-30-2-19-29-22-36-4-17-7-29 12-18 25" fill="#FCE9A9"/><text x="290" y="155" text-anchor="middle" fill="{ink}" stroke="none" font-size="13" font-family="sans-serif">Network / Cloud</text></g>
      <g id="actuator"><rect x="358" y="70" width="32" height="60" rx="8" fill="#FCE3D2"/><path d="M365 84h18m-9 0v32m-10 0h20"/><text x="374" y="155" text-anchor="middle" fill="{ink}" stroke="none" font-size="13" font-family="sans-serif">Actuator</text></g>
    </svg>'''
    return ResolvedIllustration(svg, [
        {"id": "sensor", "label": "Sensors", "x": 14, "y": 61, "w": 72, "h": 78},
        {"id": "microcontroller", "label": "Microcontroller", "x": 124, "y": 53, "w": 82, "h": 94},
        {"id": "cloud", "label": "Network / Cloud", "x": 252, "y": 72, "w": 76, "h": 52},
        {"id": "actuator", "label": "Actuator", "x": 354, "y": 66, "w": 40, "h": 68},
    ])


class IllustrationResolver:
    def __init__(self) -> None:
        self._client = genai.Client(api_key=os.environ.get("GOOGLE_API_KEY", ""), http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)))
        self._cache: dict[str, ResolvedIllustration | None] = {}

    async def resolve(self, query: str) -> str | None:
        result = await self.resolve_details(query)
        return result.svg if result else None

    async def resolve_details(self, query: str) -> ResolvedIllustration | None:
        key = _normalise(query)
        if not key:
            return None
        if key in self._cache:
            return self._cache[key]
        composition = _iot_composition(key)
        if composition:
            self._cache[key] = composition
            return composition
        svg = self._try_local(key)
        if not svg:
            svg = await self._try_iconify(key)
        if not svg:
            svg = _compose_svg(key)
        if not svg:
            svg = await self._try_gemini(query)
        result = ResolvedIllustration(svg, []) if svg else None
        self._cache[key] = result
        return result

    def _try_local(self, query: str) -> str | None:
        asset = next((name for term, name in LOCAL_ASSETS.items() if term in query), None)
        if not asset:
            return None
        try:
            svg = (ASSET_DIR / asset).read_text(encoding="utf-8").strip()
            return svg if svg.startswith("<svg") and "</svg>" in svg else None
        except OSError:
            return None

    async def _try_iconify(self, query: str) -> str | None:
        try:
            loop = asyncio.get_running_loop()
            data = json.loads(await loop.run_in_executor(None, lambda: urllib.request.urlopen(ICONIFY_SEARCH.format(q=quote(query)), timeout=8).read()))
            icons = data.get("icons", [])
            chosen = next((icon for prefix in PREFERRED_SETS for icon in icons if icon.startswith(prefix + ":")), None) or (icons[0] if icons else None)
            if not chosen or ":" not in chosen:
                return None
            prefix, name = chosen.split(":", 1)
            svg = (await loop.run_in_executor(None, lambda: urllib.request.urlopen(ICONIFY_SVG.format(prefix=prefix, name=name), timeout=8).read())).decode("utf-8").strip()
            return svg if svg.startswith("<svg") and "</svg>" in svg else None
        except Exception as exc:
            logger.warning("Iconify lookup failed for %r: %s", query, str(exc)[:100])
            return None

    async def _try_gemini(self, query: str) -> str | None:
        try:
            resp = await asyncio.wait_for(self._client.aio.models.generate_content(model="gemini-3.1-flash-lite", contents=GEMINI_SVG_PROMPT.format(query=query), config=types.GenerateContentConfig(temperature=0.3)), timeout=15)
            match = re.search(r"(<svg[\s\S]*?</svg>)", resp.text or "", re.IGNORECASE)
            return re.sub(r"<(script|image)[\s\S]*?</\1>", "", match.group(1)).strip() if match else None
        except Exception as exc:
            logger.warning("Gemini SVG generation failed for %r: %s", query, str(exc)[:100])
            return None
