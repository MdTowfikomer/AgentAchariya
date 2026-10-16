"""SerpApi search excerpts for the teacher and student source panel."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

logger = logging.getLogger("agent.research")
SERPAPI_SEARCH_URL = "https://serpapi.com/search.json"


class Researcher:
    def __init__(self) -> None:
        self._api_key = os.environ.get("SERPAPI_API_KEY", "").strip()

    async def find(self, question: str) -> list[dict]:
        """Return up to six source-backed search excerpts in relevance order."""
        if not self._api_key:
            raise ValueError("Search API key is missing. Configure SERPAPI_API_KEY.")
        question = question.strip()
        if not question:
            raise ValueError("A search question is required")
        findings = await asyncio.wait_for(
            asyncio.to_thread(_serpapi_search, self._api_key, question), timeout=20
        )
        if not findings:
            raise ValueError("SerpApi returned no usable sources")
        logger.info("research done via SerpApi", extra={"n": len(findings)})
        return findings


def _serpapi_search(api_key: str, question: str) -> list[dict]:
    params = urlencode({"engine": "google", "q": question, "api_key": api_key})
    request = Request(f"{SERPAPI_SEARCH_URL}?{params}", method="GET")
    try:
        with urlopen(request, timeout=15) as response:
            data = json.load(response)
    except HTTPError as exc:
        # Never include the request URL: it contains the API key.
        raise RuntimeError(f"SerpApi HTTP {exc.code}") from None
    except (URLError, OSError):
        raise RuntimeError("SerpApi could not be reached") from None
    except ValueError:
        raise ValueError("SerpApi returned an unreadable response") from None
    if not isinstance(data, dict):
        raise ValueError("SerpApi returned an invalid response")
    if data.get("error"):
        error = str(data["error"]).lower()
        if any(word in error for word in ("quota", "limit", "credit", "run out")):
            raise RuntimeError("SerpApi search quota exhausted")
        if any(word in error for word in ("key", "unauthorized", "authentication")):
            raise RuntimeError("SerpApi API key rejected")
        raise RuntimeError("SerpApi search failed")
    return _serpapi_findings(data)


def _serpapi_findings(data: object) -> list[dict]:
    """Normalize organic results without inventing claims or source links."""
    if not isinstance(data, dict) or data.get("error"):
        return []
    results = data.get("organic_results")
    if not isinstance(results, list):
        return []
    findings: list[dict] = []
    seen: set[str] = set()
    for item in results:
        if not isinstance(item, dict):
            continue
        url, snippet = item.get("link"), item.get("snippet")
        if not isinstance(url, str) or not isinstance(snippet, str):
            continue
        url = url.strip()
        try:
            parsed = urlsplit(url)
        except ValueError:
            continue
        point = re.sub(r"\s+", " ", snippet).strip()
        if parsed.scheme not in ("http", "https") or not parsed.hostname or len(point) < 12 or url in seen:
            continue
        if len(point) > 280:
            point = point[:277].rsplit(" ", 1)[0] + "…"
        title = item.get("title")
        findings.append({
            "point": point,
            "source": title.strip() if isinstance(title, str) and title.strip() else parsed.hostname,
            "url": url,
        })
        seen.add(url)
        if len(findings) == 6:
            break
    return findings
