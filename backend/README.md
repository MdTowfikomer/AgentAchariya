# Agent Acharya — backend

The live teacher: a LiveKit agent on Gemini 3.8 Live that teaches on a shared
whiteboard. See the [project README](../../README.md) for the full picture.

```bash
cp .env.example .env.local   # LIVEKIT_*, GOOGLE_API_KEY, SERPAPI_API_KEY
uv sync
uv run python src/agent.py download-files
uv run python src/agent.py start
```

| File | |
|---|---|
| `src/agent.py` | Registers the worker |
| `src/board_session.py` | The live class: teachers, board tools, student marks, visual director hook |
| `src/board.py` | Board state and the lesson planner |
| `src/visuals.py` | Visual director — a diagram for every question |
| `src/media.py` | Background Klein topic images and Schnell follow-up illustrations |
| `src/research.py` | SerpApi Google search excerpts with original sources |
| `src/board_prompts.py` | The teacher's instructions |
| `src/memory.py`, `src/analytics.py` | Optional Postgres memory and class analytics |

## Live research

Set `SERPAPI_API_KEY` in `backend/.env.local` and restart the worker. This
replaces Tavily; `TAVILY_API_KEY` is no longer read. The teacher's `research`
tool queries SerpApi's Google Search API, shows up to six linked organic-result
snippets in the student panel, and uses that evidence in the lesson. Queries
retain the language supplied by the teacher.

Snippets are search excerpts, not full-page verification. Missing credentials,
quota errors, unavailable search, or empty results report a failed search;
there is no silent fallback to another search provider. If the teacher answers
from prior knowledge after a failure, it must identify that limitation.

Live student controls request a simpler explanation, a worked example, or one
comprehension question using the current board and teaching language.

## Live topic images

With `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` configured, restart the
worker to enable classroom images. Set `IMAGE_GENERATION_ENABLED=0` to disable
them. No frontend key or separate image server is needed.

The teacher's diagram/lesson tools start one FLUX.2 Klein 4B overview for a new
topic. Visual follow-ups use FLUX.1 Schnell, including simpler-explanation and
example requests. The visual director supplies a fallback request when the
teacher does not draw. Comprehension checks do not request an answer image.

Voice and precise SVG diagrams continue while images generate. Each model has
its own generation lane, so an overview does not block a follow-up. Repeated
requests in a turn are deduplicated; an in-memory cache retains up to 32 recent
images across classrooms in the same worker. Queued work is bounded, and stale
results are discarded if the topic changes. Results always target the original
board. Images arrive through the existing LiveKit byte stream and are archived
with the lesson by the frontend.

Prompts forbid embedded text, but model compliance and scientific accuracy are
not guaranteed. The teacher treats generated images as conceptual illustrations,
while SVG remains the precise, labelled teaching surface. Generation errors
show a non-blocking status; there are no automatic provider retries.

## Preview topic images

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in `.env.local`.
From `backend/`, run:

```powershell
.\.venv\Scripts\python.exe scripts\preview_topic_images.py "Photosynthesis" --focus "How leaves use sunlight to make sugar"
```

Omit the topic to enter it interactively. Each run makes one request to FLUX.2
Klein 4B for the primary textbook illustration and one to FLUX.1 Schnell for a
sparse hand-drawn explanation. It does not launch or modify the live classroom.
These requests consume your Cloudflare allocation; there are no automatic retries.

Open the printed `index.html` in a browser to compare both images and prompts.
Images, timings, and `manifest.json` are saved to a unique folder under
`backend/image-previews/` (ignored by Git). Failed requests remain visible in
the preview; successful images are preserved even if the other model fails.

Prompts request no embedded text by default: live trials produced garbled labels
on both models, even when text was forbidden. This setting is not a guarantee.
Use `--with-labels --label-language Telugu` to experiment with generated labels;
always inspect the result before teaching with the image.

Use `--dry-run` to inspect prompts without using the API. Optional controls:
`--seed 42`, `--output-dir PATH`,
`--primary-prompt-file PATH`, and `--explanation-prompt-file PATH`.
Klein uses 1024×576; Schnell uses its provider-default size because its documented
schema does not expose dimensions. Inspect factual accuracy and generated text
before using an image in a lesson.
