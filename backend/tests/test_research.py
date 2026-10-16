"""Research contract, provider failure handling, and student action delivery."""

import io
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

import research
from board_session import MarkRelay


def test_search_encodes_multilingual_queries_and_retains_source(monkeypatch):
    observed = {}

    def respond(request, timeout):
        observed.update(parse_qs(urlsplit(request.full_url).query))
        assert timeout == 15
        return io.BytesIO(json.dumps({"organic_results": [{
            "title": "Science source", "link": "https://example.org/science",
            "snippet": "A source excerpt explaining the concept.",
        }]}).encode())

    monkeypatch.setattr(research, "urlopen", respond)
    result = research._serpapi_search("test-key", "నీటి చక్రం & science")
    assert observed == {"engine": ["google"], "api_key": ["test-key"], "q": ["నీటి చక్రం & science"]}
    assert result[0]["url"] == "https://example.org/science"


def test_search_filters_unsafe_duplicate_and_incomplete_results():
    valid = {"link": "https://example.org/source", "snippet": "An actual source excerpt with evidence."}
    results = [None, {"link": "javascript:alert(1)", "snippet": valid["snippet"]},
               {"link": "https://example.org/no-snippet"}, valid, valid]
    results.extend({"link": f"https://example.org/{i}", "snippet": "word " * 90} for i in range(10))
    findings = research._serpapi_findings({"organic_results": results})
    assert len(findings) == 6
    assert findings[0]["source"] == "example.org"
    assert len({f["url"] for f in findings}) == 6
    assert all(len(f["point"]) <= 280 for f in findings)
    assert research._serpapi_findings({"organic_results": None}) == []


@pytest.mark.parametrize("code", [401, 429, 500])
def test_http_errors_never_expose_key(monkeypatch, code):
    def fail(request, timeout):
        raise HTTPError(request.full_url, code, "private-key", None, None)

    monkeypatch.setattr(research, "urlopen", fail)
    with pytest.raises(RuntimeError, match=f"HTTP {code}") as caught:
        research._serpapi_search("private-key", "science")
    assert "private-key" not in str(caught.value)
    assert caught.value.__suppress_context__


@pytest.mark.parametrize(("error", "expected"), [
    ("Your account has run out of searches.", "quota"),
    ("Invalid API key: private-key", "key rejected"),
])
def test_provider_errors_are_safe_and_actionable(monkeypatch, error, expected):
    monkeypatch.setattr(research, "urlopen", lambda *args, **kwargs: io.BytesIO(json.dumps({"error": error}).encode()))
    with pytest.raises(RuntimeError, match=expected) as caught:
        research._serpapi_search("private-key", "science")
    assert "private-key" not in str(caught.value)


@pytest.mark.asyncio
async def test_missing_key_and_empty_results_fail_without_another_provider(monkeypatch):
    monkeypatch.delenv("SERPAPI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="SERPAPI_API_KEY"):
        await research.Researcher().find("science")
    monkeypatch.setenv("SERPAPI_API_KEY", "test-key")
    monkeypatch.setattr(research, "_serpapi_search", lambda *args: [])
    with pytest.raises(ValueError, match="no usable sources"):
        await research.Researcher().find("science")


@pytest.mark.asyncio
@pytest.mark.parametrize(("action", "expected"), [
    ("simplify", "more simply"), ("example", "worked example"), ("check", "Wait for the student"),
])
async def test_learning_action_uses_selected_board_and_language(action, expected):
    session = SimpleNamespace(interrupt=Mock(), generate_reply=Mock())
    board = SimpleNamespace(inventory=lambda: "Current board: Water cycle")
    images = SimpleNamespace(topic=lambda page: "", request=Mock())
    board.current = SimpleNamespace()
    relay = MarkRelay(session, SimpleNamespace(board=board, lang="hi", images=images))
    relay._follow_page = AsyncMock()
    relay.flush = AsyncMock()
    relay._inject = AsyncMock()
    reader = SimpleNamespace(read_all=AsyncMock(return_value=json.dumps({
        "type": "learning_action", "action": action, "board": "b2",
    })))
    await relay.handle(reader, "student")
    assert relay._follow_page.await_args.args[0]["board"] == "b2"
    instructions = relay._inject.await_args.args[0]
    assert expected in instructions
    assert "Hindi" in instructions
    assert "Water cycle" in instructions
    session.interrupt.assert_called_once()
    session.generate_reply.assert_called_once()


@pytest.mark.asyncio
async def test_unknown_learning_action_does_not_interrupt():
    session = SimpleNamespace(interrupt=Mock(), generate_reply=Mock())
    relay = MarkRelay(session, SimpleNamespace())
    relay._follow_page = AsyncMock()
    reader = SimpleNamespace(read_all=AsyncMock(return_value=json.dumps({
        "type": "learning_action", "action": "unknown",
    })))
    await relay.handle(reader, "student")
    session.interrupt.assert_not_called()
    session.generate_reply.assert_not_called()
