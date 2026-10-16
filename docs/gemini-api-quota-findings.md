# Gemini API quota findings

Checked 2026-10-03 against Google’s Gemini API documentation.

## Why normal Gemini features can work while live research fails

The application’s live teacher, lesson planner, visual director, and SVG fallback make ordinary Gemini generation calls. The research feature is different: it calls `generate_content` with `GoogleSearch()` enabled in `backend/src/research.py`. Google Search grounding has a separate availability and usage limit from ordinary model inference.

That means a successful voice, planning, or illustration request does **not** demonstrate that Google Search grounding is available for the same API project.

## Models configured by this project

| Surface | Primary model | Fallbacks / detail |
| --- | --- | --- |
| Live teaching | `gemini-3.8-live` | `backend/src/board_session.py` |
| Lesson planning | `gemini-3.1-flash-lite` | Falls back to `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, then `gemini-3.8-flash`. |
| Visual director | `gemini-3.1-flash-lite` | Same fallback sequence. |
| SVG generation fallback | `gemini-3.1-flash-lite` | Only used when local/Iconify/composed SVG resolution does not satisfy the request. |
| Live research | `gemini-3.1-flash-lite` | Same fallback sequence **and** `GoogleSearch()` grounding. |

The research fallback loop cannot bypass a grounding entitlement or a project-level grounding quota: every attempted model enables the same search tool.

## Free tier and 429 interpretation

Google applies Gemini API limits at the **project** level (not per API key), across requests per minute, tokens per minute, and requests per day. Exceeding any applicable limit can result in HTTP 429, and daily limits reset at midnight Pacific time. Exact live values vary by model and usage tier, so the project’s AI Studio rate-limits page is the authoritative value for this key.

Google’s pricing documentation distinguishes ordinary model inference from Google Search grounding. In particular, it lists free-tier ordinary inference for Gemini 3.5 Flash-Lite, while API Google Search grounding is not available on the free tier (apart from testing in AI Studio). On eligible paid tiers, Google documents a shared monthly Google Search grounding allowance for Gemini 3.x and then per-search-request charges; one model response may trigger multiple search queries.

So the observed result—ordinary Gemini services working, but every grounded research model returning `429 RESOURCE_EXHAUSTED`—is consistent with missing/exhausted Google Search grounding access rather than a general outage of the API key.

Do not rely on the source comment that labels a particular model as having a “high free-tier quota” or another as “20/day”; quota tables and availability can change, and Google directs users to AI Studio for the active project/model limits.

## Official sources

- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API pricing, including Google Search grounding](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API error codes](https://ai.google.dev/gemini-api/docs/api-errors)
