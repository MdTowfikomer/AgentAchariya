# Agent Acharya (AA) — Live Multimodal AI Teacher on an Interactive Whiteboard

> **A real-time, voice-first AI teacher that teaches complex STEM and technical concepts on a dynamic whiteboard in regional Indian languages (Telugu, Tamil, Kannada, Hindi) and English.**

[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2015-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Python](https://img.shields.io/badge/Backend-Python%203.12-blue?style=flat&logo=python)](https://python.org/)
[![LiveKit](https://img.shields.io/badge/WebRTC-LiveKit-teal?style=flat&logo=livekit)](https://livekit.io/)


---

## 📌 Problem & Vision

Traditional AI learning interfaces are passive, text-heavy chatbots. When students struggle with complex STEM, computer science, or engineering topics:
- Text chats require endless typing and break cognitive focus.
- Static diagrams cannot adapt to where the student is confused.
- Quality interactive education is rarely accessible in native regional Indian languages.

**Agent Achariya** solves this by recreating the experience of an expert human tutor sitting beside you at a shared desk: **conversing naturally with ultra-low latency voice**, **drawing diagrams and formulas in real time on a whiteboard**, and **adapting instantly whenever you circle, point, or interrupt**.

---

## 🚀 Key Features

| Capability | Description |
|---|---|
| **Natural Voice Interaction** | Powered by **Gemini 3.8 Live** over WebRTC via **LiveKit**. Natural barge-in: interrupt mid-sentence and the teacher stops, listens, and adapts without losing context. |
| **Multilingual by Design** | Real-time instruction and UI localized in **Telugu, Tamil, Kannada, Hindi, and English**. The teacher seamlessly switches languages the moment the student does. |
| **Autonomous Visual Director** | While the teacher speaks, an asynchronous background **Visual Director (Gemini Flash)** selects and renders custom SVG diagrams, concept trees, code execution steps, and comparison cards. |
| **Bidirectional "Circle to Ask"** | Students can circle, underline, or highlight any formula, cell, or diagram segment. The canvas captures the spatial mark and image crop, sending it directly to Achariya to explain that exact part. |
| **Live Web Grounding & Sources** | For current events, data, and technical specifications, Achariya verifies information via Google Search grounding and presents cited references in a dedicated Research Drawer. |
| **Physical Analogies & Teardowns** | Integrates physical mechanical analogies (via the **Anatomy** engine) — turning abstract computing ideas (caches, pipelines, locks) into intuitive visual machines. |
| **Student Progress Analytics** | Comprehensive session monitoring and mastery metrics tracking comprehension, questions asked, and topics explored. |

---

## 🏗️ Architecture & How It Works

```
                        ┌─────────────────────────────────────────┐
                        │              STUDENT BROWSER            │
                        │       (Next.js 15 + SVG Canvas)         │
                        └───────────────────▲─────────────────────┘
                                            │
                        WebRTC Audio        │  Data Channel
                      & Canvas Events       │  (Draw Ops, Marks, Readouts)
                                            ▼
                        ┌─────────────────────────────────────────┐
                        │             LIVEKIT SERVER              │
                        │        (Real-time Audio & Data)         │
                        └───────────────────▲─────────────────────┘
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               │                                                         │
               ▼                                                         ▼
┌───────────────────────────────┐                       ┌───────────────────────────────┐
│     LiveKit Python Agent      │                       │        Visual Director        │
│      (board_session.py)       │                       │          (visuals.py)         │
├───────────────────────────────┤                       ├───────────────────────────────┤
│ • Gemini 3.8 Live (Voice)     │ ─── State Sync ───►  │ • Gemini Flash (Diagrams)     │
│ • Speech Tracker & Interrupts │                       │ • SVG / Layout Solver         │
│ • Circle-to-Ask Mark Reducer  │                       │ • Research & Web Grounding    │
└───────────────────────────────┘                       └───────────────────────────────┘
```

### The Multimodal Orchestration Cycle:
1. **Student Speaks:** Audio streams via WebRTC into `board_session.py`.
2. **Gemini 3.8 Live Responds:** Generates instant conversational audio with native tone and emotion.
3. **Visual Director Triggers:** Secondary Flash model independently synthesizes a structured visual diagram (flow, cycle, layers, timeline, anatomy) matching the pedagogical turn.
4. **Deterministic Layout Solver:** Frontend layout engine computes non-overlapping bounding coordinates and animates the drawings smoothly without blocking audio.
5. **Student Circles a Detail:** Student draws a circle with their mouse/touch $\rightarrow$ vector marks and bounding crops stream back to the agent $\rightarrow$ Achariya immediately interrupts to explain that exact element.

---

## 🛠️ Tech Stack & Models

- **Speech & Conversational Intelligence:** `gemini-3.8-live` via LiveKit Agents Python SDK.
- **Visual Intelligence & Planning:** `gemini-3.8-flash` / `gemini-3.1-flash-lite`.
- **Image Generation & Infographics:** `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite).
- **WebRTC Transport:** [LiveKit Cloud](https://livekit.io/) (low-latency audio tracks + bidirectional data channel).
- **Frontend Canvas:** Next.js 15 (App Router), React, Tailwind CSS, Lucide icons, Motion.
- **Backend Runtime:** Python 3.12, `google-genai` SDK, `uv`, `pytest`.

---

## 📂 Project Structure

```text
AgentAchariya/
├── backend/
│   ├── src/
│   │   ├── agent.py            # LiveKit entrypoint & worker configuration
│   │   ├── board_session.py    # Gemini Live session, tool dispatch, & mark tracking
│   │   ├── board.py            # Whiteboard state machine & lesson planner
│   │   ├── visuals.py          # Asynchronous Visual Director & layout engine
│   │   ├── illustrations.py    # Semantic SVG icons & composition solver
│   │   ├── media.py            # Image generation & annotation pipelines
│   │   ├── research.py         # Google Search grounding & citation drawer
│   │   └── config.py           # Environment & credentials validation
│   ├── tests/                  # Pytest test suite (smoke & media unit tests)
│   └── pyproject.toml          # UV / Python dependencies
├── frontend/
│   ├── app/                    # Next.js 15 pages (desk, dashboard, stats, monitor)
│   ├── components/
│   │   ├── nova/board/         # Whiteboard canvas, sketch, layout, & speech tracker
│   │   ├── agents-ui/          # Audio visualizers, track controls, and session blocks
│   │   └── ai-elements/        # Dynamic message and conversation blocks
│   └── hooks/                  # Audio visualization & control hooks
└── .agents/skills/             # Local agent skill extensions (e.g., anatomy)
```

---

## ⚡ Getting Started

### Prerequisites
- **Node.js** (v20+) & **pnpm**
- **Python** (v3.12+) & **[uv](https://github.com/astral-sh/uv)**
- **Google AI Studio Key** with access to Gemini Live & Flash models
- **LiveKit Cloud** credentials (URL, API Key, API Secret)

### 1. Backend Setup
```bash
cd backend

# Create environment configuration
cp .env.example .env
# Fill in:
# LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
# GEMINI_API_KEY

# Install dependencies and start the backend agent
uv run python -m src.agent dev
```

### 2. Frontend Setup
```bash
cd ../frontend

# Install dependencies
pnpm install

# Create environment configuration
cp .env.example .env.local
# Fill in matching LiveKit and Gemini credentials

# Start Next.js development server
pnpm dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser and click **"Start Class"**.

---

## 🧪 Testing

```bash
# Run backend test suite
cd backend
uv run -m pytest tests/test_smoke.py

# Run frontend tests
cd ../frontend
pnpm test
```

---
