"""The Visual Director: a diagram for every question, drawn as pure SVG.

The Live teacher is busy talking; left to itself it draws when it remembers.
So every time the student finishes a question, this second agent (Gemini 3.8
Flash) looks at the question and the board, and DECIDES the visuals itself:

  - always a diagram, in the form that fits the subject — a stacked-layers
    picture for the OSI model, a cycle for the water cycle, a timeline for
    history, a hub for "types of", a comparison for "X vs Y".

Precise diagrams use SVG. Optional wordless image requests run independently
through the background image pipeline. The teacher is told what appeared.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os

from google import genai
from google.genai import types

logger = logging.getLogger("agent.visuals")

DIRECTOR_MODELS = [
    os.getenv("DIRECTOR_MODEL", "gemini-3.1-flash-lite"),
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.8-flash",
]

LAYOUTS = ["flow", "cycle", "hub", "timeline", "layers", "compare"]
# The renderer deliberately has a small number of proven geometries.  The
# director may name a richer teaching intent, which is mapped to one of them.
DIAGRAM_TYPES = [
    "flowchart", "cycle", "timeline", "concept_map", "anatomy",
    "comparison", "network", "layers", "technical_diagram", "graph", "hierarchy",
]
TYPE_LAYOUT = {
    "flowchart": "flow", "cycle": "cycle", "timeline": "timeline",
    "concept_map": "hub", "anatomy": "hub", "comparison": "compare",
    "network": "hub", "layers": "layers", "technical_diagram": "flow",
    "graph": "hub", "hierarchy": "layers",
}
VISUAL_ACTIONS = ["SHOW", "HIGHLIGHT", "LABEL", "CONNECT", "FLOW", "PULSE", "ZOOM", "ANIMATE"]
COLORS = ["blue", "green", "orange", "pink", "purple", "yellow", "gray"]

_S = types.Schema
_STR = _S(type="STRING")

DIAGRAM_SCHEMA = _S(
    type="OBJECT",
    properties={
        "title": _S(type="STRING", description="Short title, under 40 characters."),
        "layout": _S(type="STRING", enum=LAYOUTS),
        "diagram_type": _S(type="STRING", enum=DIAGRAM_TYPES),
        "nodes": _S(
            type="ARRAY",
            description="3 to 8 nodes.",
            items=_S(
                type="OBJECT",
                properties={
                    "id": _STR,
                    "label": _S(type="STRING", description="Under 22 characters."),
                    "icon": _S(
                        type="STRING",
                        description="ONE emoji that makes this node recognisable at a glance.",
                    ),
                    "note": _S(
                        type="STRING",
                        description="Optional detail under 40 chars: a date, a number, a function.",
                    ),
                    "color": _S(type="STRING", enum=COLORS),
                    "group": _S(
                        type="STRING",
                        description="layout=compare only: which side, e.g. 'TCP' or 'UDP'.",
                    ),
                    "description": _S(
                        type="STRING",
                        description=(
                            "One or two sentence explanation of this node's role or meaning. "
                            "Under 120 characters. Provide for EVERY node when the question "
                            "asks to explain, understand, or learn a topic."
                        ),
                    ),
                    "bullets": _S(
                        type="ARRAY",
                        description=(
                            "2 to 4 key facts, properties, or responsibilities as short bullet points. "
                            "Under 50 characters each. Provide for EVERY node when the question "
                            "asks to explain, understand, or learn a topic."
                        ),
                        items=_S(type="STRING"),
                    ),
                },
                required=["id", "label", "icon", "color"],
            ),
        ),
        "edges": _S(
            type="ARRAY",
            items=_S(
                type="OBJECT",
                properties={
                    "from": _STR,
                    "to": _STR,
                    "label": _S(
                        type="STRING", description="Under 16 characters, or empty."
                    ),
                },
                required=["from", "to"],
            ),
        ),
    },
    required=["title", "layout", "nodes"],
)

SUPPORTING_VISUAL_SCHEMA = _S(
    type="OBJECT",
    properties={
        "subject": _S(type="STRING", description="The specific teachable object, e.g. 'left ventricle', 'chloroplast', 'router'."),
        "role": _S(type="STRING", description="What this visual clarifies. Never decoration."),
        "placement": _S(type="STRING", enum=["side", "integrated", "below", "full"]),
        "links": _S(type="ARRAY", description="Explanation point to semantic visual-part links; use real SVG component names.", items=_S(
            type="OBJECT", properties={"point": _STR, "target": _STR}, required=["point", "target"]
        )),
        "actions": _S(type="ARRAY", items=_S(
            type="OBJECT",
            properties={"action": _S(type="STRING", enum=VISUAL_ACTIONS), "target": _STR, "label": _STR},
            required=["action"],
        )),
    },
    required=["subject", "role"],
)

DIRECTOR_SCHEMA = _S(
    type="OBJECT",
    properties={
        "skip": _S(
            type="BOOLEAN",
            description=(
                "True for greetings, thanks, yes/no, small talk, and continuations like "
                "'okay continue', 'next', 'go on' — nothing new to show."
            ),
        ),
        "image_request": _S(
            type="OBJECT",
            description="One wordless educational image: overview for a new topic, specific explanation for a follow-up. Omit for comprehension checks or answers to quizzes.",
            properties={
                "topic": _S(type="STRING", description="Canonical overall topic in English. Keep the current image topic exactly for follow-ups."),
                "focus": _S(type="STRING", description="Concrete scene or relationship to illustrate, in English, under 300 characters; no labels or text."),
            },
            required=["topic", "focus"],
        ),
        "diagram": DIAGRAM_SCHEMA,
        "illustration_query": _S(
            type="STRING",
            description=(
                "For physical/visual things (car, engine, heart, lightbulb, plant, cell, "
                "circuit, building, molecule, organ, device), a short search query for an "
                "SVG illustration icon. Use alongside diagram for richer visuals. "
                "One or two words: 'lightbulb', 'car', 'plant cell', 'cpu chip'."
            ),
        ),
        "supporting_visual": SUPPORTING_VISUAL_SCHEMA,
    },
    required=["skip"],
)

PROMPT = """\
You are the visual director for a live teacher. The student just said:

"{question}"

What is already on the board:
{board}

Current image topic: {image_topic}
If this is a new topic, set image_request.topic to its canonical English name
and focus to the overview scene. If this is a follow-up on the current topic,
reuse its exact name and describe the specific visual that would help. Skip
image_request for greetings, continuations, quiz answers and comprehension
checks. Images are conceptual pictures with NO embedded words, labels or text;
the SVG diagram carries precise labels and relationships. Do not put a full
prompt in focus; describe only the concrete scene to illustrate.

Design a pure SVG diagram for THIS question, separate from image_request.
The diagram renderer draws hand-drawn SVG on the whiteboard. Rules:
- Unless it is pure small talk, ALWAYS design a diagram — every real question
  gets one. Make it specific to the subject and instantly recognisable:
    layers   — stacked levels: OSI/TCP-IP model, atmosphere, org hierarchy,
               software stack, food pyramid (first node = top layer)
    cycle    — anything that loops: water cycle, heart beat, business cycle
    timeline — history, versions, stages of life, a process with dates
    hub      — "types of", "parts of", "features of": centre node first,
               the rest around it
    compare  — "X vs Y": give every node a group (exactly two groups)
    flow     — processes, systems, cause -> effect, data/money/blood flow
- Name the teaching intent in `diagram_type` too: anatomy for labelled body or
  machine parts, network for connected computers, concept_map for related
  ideas. The renderer maps it to its existing geometry.
- Every node gets a fitting emoji icon and a colour; use colour to group
  related nodes. Use notes for the one number or fact that matters.
- Edges carry short labels only where they add meaning. Every edge must use
  node ids that exist. No duplicate nodes. Nothing already on the board.
- ANNOTATED INFOGRAPHIC: For every explanatory question (explain, how does,
  what is, teach me, describe), add a `description` and `bullets` to EACH
  node. The description is 1-2 sentences about that node's role. The bullets
  are 2-4 key facts shown as an info card beside the node on the whiteboard.
  This creates a rich annotated infographic — like a textbook diagram with
  callout boxes. Skip description/bullets only for quick "draw me a diagram"
  requests where the student just wants the shape, not the explanation.
- SUPPORTING VISUAL: Add `supporting_visual` ONLY when a concrete visual helps
  understand the topic. Its subject must be specific (not "science icon"),
  role must say what it explains, placement is side/integrated/below/full, and
  actions are a short ordered teaching sequence (SHOW, HIGHLIGHT, LABEL,
  CONNECT, FLOW, PULSE, ZOOM, ANIMATE). Also set `illustration_query` to the
  same concise subject for backwards compatibility. Do not add decoration.
  For systems with connected components (IoT, networks, feedback systems), use
  a composition subject such as "IoT system" rather than one component. Name
  action targets after components and express flows as `sensor -> cloud`. Add
  `links` from each explanation point to its relevant node/component. Prefer a
  composed mini-diagram whenever relationships are the lesson; never use an
  icon merely to fill space.
- All text in English. Be accurate — no invented facts.
"""


class VisualDirector:
    def __init__(self) -> None:
        api_key = os.environ.get("GOOGLE_API_KEY", "")
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                retry_options=types.HttpRetryOptions(attempts=1)
            ),
        )

    async def direct(self, question: str, board: str, image_topic: str = "") -> dict | None:
        prompt = PROMPT.format(question=question, board=board, image_topic=image_topic or "none yet")
        for model in DIRECTOR_MODELS:
            try:
                resp = await asyncio.wait_for(
                    self._client.aio.models.generate_content(
                        model=model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=DIRECTOR_SCHEMA,
                            temperature=0.5,
                            thinking_config=types.ThinkingConfig(thinking_level="low"),
                        ),
                    ),
                    timeout=15,
                )
                return json.loads(resp.text or "{}")
            except Exception as exc:
                logger.warning("director via %s failed: %s", model, str(exc)[:120])
        return None


def clean_diagram(d: dict | None) -> dict | None:
    """Validate a director/planner diagram into the board's element shape."""
    if not d:
        return None
    nodes = []
    seen: set[str] = set()
    for n in d.get("nodes") or []:
        nid, label = str(n.get("id") or "").strip(), str(n.get("label") or "").strip()
        if not nid or not label or nid in seen:
            continue
        seen.add(nid)
        node = {"id": nid, "label": label[:28]}
        for f in ("icon", "note", "color", "group"):
            if n.get(f):
                node[f] = str(n[f])[:44]
        if n.get("description"):
            node["description"] = str(n["description"])[:150]
        if n.get("bullets") and isinstance(n["bullets"], list):
            node["bullets"] = [str(b)[:60] for b in n["bullets"][:4]]
        nodes.append(node)
    nodes = nodes[:8]
    if len(nodes) < 2:
        return None
    ids = {n["id"] for n in nodes}
    edges = [
        {
            "from": str(e["from"]),
            "to": str(e["to"]),
            "label": str(e.get("label") or "")[:18],
        }
        for e in d.get("edges") or []
        if e.get("from") in ids and e.get("to") in ids and e.get("from") != e.get("to")
    ]
    diagram_type = d.get("diagram_type") if d.get("diagram_type") in DIAGRAM_TYPES else ""
    layout = d.get("layout") if d.get("layout") in LAYOUTS else TYPE_LAYOUT.get(diagram_type, "flow")
    return {
        "kind": "diagram",
        "layout": layout,
        **({"diagramType": diagram_type} if diagram_type else {}),
        "nodes": nodes,
        "edges": edges,
        "label": str(d.get("title") or "")[:48],
    }


def clean_supporting_visual(visual: dict | None, legacy_query: str = "") -> dict | None:
    """Keep only a specific, instructional visual request from the director."""
    visual = visual if isinstance(visual, dict) else {}
    subject = str(visual.get("subject") or legacy_query or "").strip()
    role = str(visual.get("role") or "").strip()
    # A one-word generic decoration is not a visual plan. Legacy queries may
    # supply the subject, but never bypass the instructional-role requirement.
    generic = {"icon", "illustration", "graphic", "image", "science", "technology"}
    if not subject or not role or subject.lower() in generic:
        return None
    actions = []
    seen_actions: set[tuple[str, str]] = set()
    for item in visual.get("actions") or []:
        action = str(item.get("action") or "").upper()
        target = str(item.get("target") or "")[:48]
        key = (action, target.lower())
        if action in VISUAL_ACTIONS and key not in seen_actions:
            seen_actions.add(key)
            actions.append({
                "action": action,
                **({"target": target} if target else {}),
                **({"label": str(item["label"])[:48]} if item.get("label") else {}),
            })
    links = []
    seen_targets: set[str] = set()
    for item in visual.get("links") or []:
        point, target = str(item.get("point") or "").strip(), str(item.get("target") or "").strip()
        if point and target and target.lower() not in seen_targets:
            seen_targets.add(target.lower())
            links.append({"point": point[:64], "target": target[:48]})
    return {
        "subject": subject[:64],
        "role": role[:120],
        "placement": visual.get("placement") if visual.get("placement") in {"side", "integrated", "below", "full"} else "side",
        "actions": actions[:5] or [{"action": "SHOW"}],
        "links": links[:6],
    }
