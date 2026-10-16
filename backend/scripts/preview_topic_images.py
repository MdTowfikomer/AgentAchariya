"""Preview two Cloudflare image models without starting or changing the teacher.

From backend: .venv/Scripts/python.exe scripts/preview_topic_images.py Photosynthesis
Omit the topic for an interactive prompt. Use --dry-run to inspect prompts for free.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import html
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
MODELS = {
    "primary": "@cf/black-forest-labs/flux-2-klein-4b",
    "explanation": "@cf/black-forest-labs/flux-1-schnell",
}


def build_prompts(topic: str, language: str, focus: str | None, with_labels: bool = False) -> dict[str, str]:
    science = ""
    metaphor = "Use a concrete visual metaphor, with one action that makes the idea easy to understand. "
    if topic.lower().strip() in ("photosynthesis", "photosysthesis"):
        science = (
            "Show a green plant with leaves, stem and roots, a sun above, and a soil cutaway. "
            "Sunlight reaches leaves; water enters roots and moves up the stem; carbon dioxide "
            "enters leaves; oxygen leaves the leaves; sugar is made in the leaves. "
            "Do not depict soil minerals as reactants in the photosynthesis equation. "
        )
        if not focus or "sugar" in focus.lower():
            metaphor = (
                "Draw a leaf-shaped workshop as an analogy for a leaf making food. "
                "On the left, water droplets and carbon dioxide bubbles enter the workshop; "
                "above it, a yellow sun supplies energy. A small black worker inside the "
                "workshop operates a simple machine; sugar cubes and oxygen bubbles emerge "
                "on the right. Make the input-to-output story visually obvious. "
            )
    labels = (
        f"Use at most three very short correctly spelled labels in {language}. "
        if with_labels else "Absolutely no text, letters, numbers, words, labels or captions anywhere in the image. "
    )
    return {
        "primary": (
            f"Create a clear educational overview illustration about {topic} for a student. "
            "Landscape composition, complete subject fully visible, generous margins. "
            "Colorful textbook illustration, clean shapes, legible structure, restrained detail. "
            "Show the actual subject and its most important parts or process. "
            f"{science}{labels}Use clear directional arrows where needed. "
            "No decorative title, watermark, invented facts, or dense paragraphs. "
            "Prioritize a scientifically correct and immediately understandable teaching visual."
        ),
        "explanation": (
            f"Create one educational explanation illustration about {topic}. "
            f"Explain this single idea: {focus or 'how the central mechanism works'}. "
            f"{metaphor}"
            "Pure white background, sparse thin slightly wobbly black hand-drawn lines, "
            "lots of empty space, horizontal composition. A small solid black oval character "
            "with two white-dot eyes and thin limbs actively demonstrates the mechanism; "
            "the character must do useful work in the explanation, not stand as decoration. "
            "Minimal red, orange and blue arrows and accents. "
            f"{labels}No gradients, shadows, paper texture, 3D render, "
            "dense infographic, or decorative title. Make the metaphor educationally accurate; "
            "do not imply that metaphorical characters literally exist inside the subject."
        ),
    }


def multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = "preview-" + uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def image_extension(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    raise ValueError("Provider response did not contain a recognized PNG, JPEG, or WebP image")


def decode_image(payload: object) -> bytes:
    if not isinstance(payload, dict) or payload.get("success") is False:
        raise ValueError("Cloudflare reported an unsuccessful generation")
    result = payload.get("result", payload)
    encoded = result.get("image") if isinstance(result, dict) else None
    if not isinstance(encoded, str):
        raise ValueError("Cloudflare response did not contain result.image")
    if encoded.startswith("data:"):
        encoded = encoded.split(",", 1)[-1]
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("Cloudflare returned invalid image data") from None
    image_extension(raw)
    return raw


def generate(role: str, prompt: str, account: str, token: str, timeout: int, seed: int | None) -> bytes:
    if role == "primary":
        fields = {"prompt": prompt, "width": "1024", "height": "576"}
        if seed is not None:
            fields["seed"] = str(seed)
        body, content_type = multipart(fields)
    else:
        # Schnell's documented schema does not offer width/height controls.
        fields = {"prompt": prompt, "steps": 4}
        if seed is not None:
            fields["seed"] = seed
        body = json.dumps(fields).encode()
        content_type = "application/json"
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODELS[role]}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if response.headers.get("Content-Type", "").startswith("image/"):
                image_extension(raw)
                return raw
            return decode_image(json.loads(raw))
    except HTTPError as exc:
        detail = ""
        try:
            failure = json.loads(exc.read())
            errors = failure.get("errors", []) if isinstance(failure, dict) else []
            detail = "; ".join(
                f"{error.get('code', '')}: {error.get('message', '')}"
                for error in errors if isinstance(error, dict)
            )
            detail = detail.replace(token, "[redacted]").replace(account, "[redacted]")[:300]
        except (ValueError, OSError):
            pass
        hint = {
            401: "Check the API token.",
            403: "Check the token's Workers AI permission, account access, and model availability.",
            429: "Quota or rate limit reached; try later.",
        }.get(exc.code, "Check Cloudflare Workers AI availability.")
        # Do not print request headers, account IDs, provider bodies, or credentials.
        raise RuntimeError(f"Cloudflare HTTP {exc.code}. {hint} {detail}".strip()) from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("Cloudflare could not be reached or the request timed out") from None


def write_gallery(folder: Path, manifest: dict) -> None:
    cards = []
    for role, item in manifest["images"].items():
        visual = (
            f'<img src="{html.escape(item["file"], quote=True)}" alt="{role} illustration">'
            if item.get("file") else f'<p>{html.escape(item.get("error", "Not generated"))}</p>'
        )
        cards.append(
            f'<section><h2>{role.capitalize()}</h2><p>{html.escape(item["model"])}</p>{visual}'
            f'<p>{item.get("seconds", 0)} seconds</p><details><summary>Prompt</summary>'
            f'<pre>{html.escape(item["prompt"])}</pre></details></section>'
        )
    page = (
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{html.escape(manifest["topic"])} — image comparison</title>'
        '<style>body{font:16px system-ui;margin:32px;background:#f6f1e9;color:#302a25}'
        'main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:24px}'
        'section{background:white;padding:20px;border-radius:12px;min-width:0}'
        'img{width:100%;height:auto;display:block}pre{white-space:pre-wrap;line-height:1.5}'
        'section>p{overflow-wrap:anywhere}summary{cursor:pointer}</style>'
        f'<h1>{html.escape(manifest["topic"])}</h1>'
        '<p>Generated previews: inspect factual correctness and labels before teaching with them.</p>'
        f'<main>{"".join(cards)}</main></html>'
    )
    (folder / "index.html").write_text(page, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("topic", nargs="?", help="Topic to illustrate; omit to enter it interactively")
    parser.add_argument("--focus", help="Single idea for the explanation image")
    parser.add_argument("--label-language", default="English")
    parser.add_argument("--with-labels", action="store_true", help="Experiment with model-generated text (often inaccurate)")
    parser.add_argument("--env-file", type=Path, default=BACKEND / ".env.local")
    parser.add_argument("--output-dir", type=Path, default=BACKEND / "image-previews")
    parser.add_argument("--primary-prompt-file", type=Path)
    parser.add_argument("--explanation-prompt-file", type=Path)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--dry-run", action="store_true", help="Save prompts without calling either model")
    parser.add_argument("--only", choices=("primary", "explanation"), help="Retry just one model; default generates both")
    args = parser.parse_args()
    topic = (args.topic or input("Topic: ")).strip()
    if not topic:
        parser.error("Enter a non-empty topic")
    if args.timeout <= 0:
        parser.error("Timeout must be positive")
    prompts = build_prompts(topic, args.label_language, args.focus, args.with_labels)
    for role in MODELS:
        path = getattr(args, f"{role}_prompt_file")
        if path:
            prompts[role] = path.read_text(encoding="utf-8").strip()
        if not prompts[role] or len(prompts[role]) > 2048:
            parser.error(f"{role} prompt must contain 1-2048 characters")
    load_dotenv(args.env_file, override=False)
    account = os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = os.getenv("CLOUDFLARE_API_TOKEN", "").strip()
    if not args.dry_run and (not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not token):
        parser.error("Set a valid CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in backend/.env.local")
    slug = re.sub(r"[^\w-]+", "-", topic, flags=re.UNICODE).strip("-")[:60] or "topic"
    folder = args.output_dir.resolve() / f"{slug}-{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
    folder.mkdir(parents=True, exist_ok=False)
    manifest = {"topic": topic, "focus": args.focus, "seed": args.seed, "images": {}}
    failures = 0
    for role, model in MODELS.items():
        if args.only and role != args.only:
            continue
        item = {"model": model, "prompt": prompts[role]}
        manifest["images"][role] = item
        (folder / f"{role}-prompt.txt").write_text(prompts[role], encoding="utf-8")
        if args.dry_run:
            item["error"] = "Dry run: no API request made"
            continue
        print(f"Generating {role}: {model}...", flush=True)
        started = time.monotonic()
        try:
            raw = generate(role, prompts[role], account, token, args.timeout, args.seed)
            filename = role + image_extension(raw)
            (folder / filename).write_bytes(raw)
            item["file"] = filename
            print(f"Saved {filename}", flush=True)
        except (RuntimeError, ValueError) as exc:
            failures += 1
            item["error"] = str(exc)
            print(f"{role}: {exc}", file=sys.stderr, flush=True)
        item["seconds"] = round(time.monotonic() - started, 2)
        (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_gallery(folder, manifest)
    print(f"Preview: {folder / 'index.html'}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
