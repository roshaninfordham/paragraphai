<div align="center">

# ParaGraph
### AI-Native Parametric Design Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Build123d](https://img.shields.io/badge/CAD-Build123d%20%2B%20OpenCascade-orange)](https://github.com/gumyr/build123d)
[![NVIDIA NIM](https://img.shields.io/badge/NVIDIA-NIM%20API-76b900?logo=nvidia&logoColor=white)](https://build.nvidia.com)
[![Anthropic](https://img.shields.io/badge/Anthropic-Claude%20Sonnet-blueviolet)](https://anthropic.com)
[![Babylon.js](https://img.shields.io/badge/3D-Babylon.js-red)](https://babylonjs.com)

**Type a description. Drop an image. Get an editable, compilable, 3D-printable parametric model.**

[Quick Start](#getting-started) · [Architecture](#architecture) · [API Reference](docs/api-reference.md) · [Challenges](CHALLENGES.md) · [Contributing](CONTRIBUTING.md)

</div>

---

## What Is ParaGraph?

ParaGraph is a **multi-agent AI system** that converts natural language or images into engineering-grade parametric 3D models. Unlike tools that generate static meshes, ParaGraph generates **editable parametric dependency graphs** — every dimension is a named, adjustable parameter, every change is logged, scored, and reversible.

---

## What Makes It Different

| Traditional AI 3D Tools | ParaGraph |
|:---|:---|
| Generate static, uneditable meshes | Generate **editable parametric systems** |
| Black-box generation — no explanation | Every step **logged, explained, reversible** |
| One-shot, hope for the best | **Autonomous iteration** with objective scoring |
| Manual editing in another tool | **Natural language editing** of any parameter |
| No quality measurement | **Objective scoring** — proportion, symmetry, features, params |
| Fail silently on bad geometry | **Auto-healing** — fillet errors retry without fillets |

---

## Architecture

### Multi-Agent Pipeline

```mermaid
flowchart TD
    A["🖊️ User Input\ntext prompt or image"] --> B

    B["🤖 Agent 1 · Nemotron\nNVIDIA NIM\nIntent Parser\nguided_json constrained decoding\n~$0.0001 / call"] --> C

    C["🧠 Agent 2 · Claude Logic\nAnthropic\nTree Builder\n3–12 node parametric graph\n~$0.002 / call"] --> D

    D["💻 Agent 3 · Claude Code\nAnthropic\nCode Generator\nBuild123d Python with math & loops\n~$0.003 / call"] --> E

    E["⚙️ Build123d Compiler\nOpenCascade BREP kernel\nPython → Binary STL\nAuto-heals fillet failures\n$0 local execution"] --> F

    F["📊 Agent 4 · Scoring Engine\nDeterministic algorithms\nProportion · Symmetry · Features · Params\nDrives iteration loop\n$0 no LLM"] --> G

    G["🎨 Babylon.js Viewport\nReal-time 3D render + STL export"] 

    style B fill:#76b900,color:#fff
    style C fill:#6B46C1,color:#fff
    style D fill:#6B46C1,color:#fff
    style E fill:#EA580C,color:#fff
    style F fill:#0369A1,color:#fff
    style G fill:#1D4ED8,color:#fff
```

### Image-to-Design Pipeline (DIR)

```mermaid
flowchart LR
    IMG["🖼️ Image / Sketch / Photo"] --> PRE
    PRE["Stage 1.1\nPreprocessing\nsharp: resize 1024px\nJPEG 85%"] --> VLM
    VLM["Stage 2\nVLM Perception\nNVIDIA Nemotron Vision\nor Claude Vision fallback"] --> DIR
    DIR["DIR JSON\nfamily · parameters\nfeatures · symmetry\nconfidence"] --> TMPL
    TMPL["Stage 3\nDeterministic\nPrompt Generation\nzero LLM cost"] --> PIPE
    PIPE["4-Agent\nPipeline"]

    style VLM fill:#76b900,color:#fff
    style TMPL fill:#0369A1,color:#fff
    style PIPE fill:#6B46C1,color:#fff
```

> **Key insight:** The VLM only handles *perception* (Stage 2). The prompt is assembled deterministically (Stage 3) — no LLM hallucinating geometry specs.

```
Image (photo/sketch/render)
    │
    ▼
┌──────────────────────────────────────┐
│  Stage 1.1: Preprocessing (sharp)    │
│  • Resize to max 1024px              │
│  • Convert to JPEG 85%              │
│  • Normalize for VLM consumption     │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  Stage 2: VLM → DIR Extraction       │
│  • NVIDIA Nemotron Vision (primary)  │
│  • Claude Vision (fallback)          │
│  • Outputs Design Intent JSON:       │
│    - family classification           │
│    - shape parameters                │
│    - feature detection               │
│    - symmetry analysis               │
└──────────────────┬───────────────────┘
                   │ DIR JSON
                   ▼
┌──────────────────────────────────────┐
│  Stage 3: DIR → Deterministic Prompt │
│  • No LLM needed — pure templates   │
│  • Family → natural language         │
│  • Features → parameter specs       │
└──────────────────┬───────────────────┘
                   │ Text prompt
                   ▼
           Existing 4-agent pipeline
```

### Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| Framework | Next.js 16, TypeScript, Tailwind CSS | Full-stack app with SSE streaming |
| 3D Viewport | Babylon.js | Real-time STL rendering + camera controls |
| Node Graph | React Flow | Parametric dependency visualization |
| State | Zustand | Single global store |
| Layout | react-resizable-panels | Resizable 4-panel split layout |
| CAD Engine | Build123d + OpenCascade (Python) | BREP geometry → binary STL |
| Intent Parser | NVIDIA Nemotron NIM + `guided_json` | NL → guaranteed-valid structured JSON |
| Tree Builder | Claude Sonnet 4.5 (Anthropic) | JSON → typed dependency graph |
| Code Generator | Claude Sonnet 4.5 (Anthropic) | Graph → Build123d Python |
| Image Analysis | Nemotron Vision + Claude Vision | Image → DIR JSON (with fallback) |
| Image Preprocessing | sharp | Resize, normalize, JPEG compress |
| Scoring | Deterministic algorithms | Objective quality metrics (no LLM) |

---

## Features

### Core Generation
- **Text → 3D in ~10s** — full 4-agent pipeline with live progress bars and timers
- **Image → 3D** — drop any photo or sketch, DIR pipeline extracts geometry intent
- **Parametric Dependency Graph** — every design relationship visualized as a node graph
- **Natural Language Editing** — "make the teeth sharper", "double the height"
- **Version History** — every generation saved, restored with one click

### Reliability & Auto-Healing
- **Fillet Auto-Heal** — fillet/chamfer failures auto-retry without fillets; model renders instead of failing
- **3-Level Vision Fallback** — NVIDIA Vision → Claude Vision → raw text extraction
- **`guided_json` Constrained Decoding** — Nemotron physically cannot produce invalid JSON
- **Defensive fillet wrapping** — code generator wraps fillets in `try/except` blocks

### Output & Observability
- **STL Export** — one-click download for 3D printing or CAD import
- **Pipeline Report** — Markdown download with tokens, costs, and timing per agent
- **Score Percentages** — proportion, symmetry, features, params shown as %, with tooltips
- **Cost Transparency** — per-agent token counts and USD cost displayed live
- **Iteration Loop** — Step / Run ×3 / Auto modes targeting a score threshold

---

## Project Structure

```
ParaGraph/
├── app/
│   ├── page.tsx                    # Main layout — viewport, graph, sidebar
│   ├── api/
│   │   ├── generate/route.ts       # SSE pipeline orchestrator (4 agents)
│   │   ├── compile/route.ts        # Build123d Python → STL compiler
│   │   ├── analyze-image/route.ts  # Image → DIR → prompt (Vision pipeline)
│   │   ├── edit-node/route.ts      # NL node editing via Claude
│   │   ├── generate-code/route.ts  # Standalone code gen from tree
│   │   ├── iterate/route.ts        # Iteration loop endpoint
│   │   └── critique/route.ts       # Critique endpoint
├── components/parametric/
│   ├── viewport-3d.tsx             # Babylon.js 3D viewer + STL export
│   ├── node-graph.tsx              # React Flow parametric graph + NL editing
│   ├── prompt-panel.tsx            # Prompt input + image drop + SSE handler
│   └── agent-monitor.tsx           # Agent cards, scores, log, version history
├── lib/
│   ├── store.ts                    # Zustand global state
│   ├── types.ts                    # TypeScript type definitions
│   ├── ai-clients.ts              # LLM client wrappers + model constants
│   ├── scoring.ts                  # Deterministic scoring functions
│   └── image-dir.ts               # DIR schema + converter (if external)
└── docs/
    ├── architecture.md             # Detailed technical architecture
    ├── dir-pipeline.md             # Image-to-design DIR documentation
    └── api-reference.md            # API endpoint documentation
```

---

## Getting Started

### Prerequisites

| Requirement | Version | Notes |
|:---|:---|:---|
| Node.js | 18+ | |
| pnpm | any | `npm i -g pnpm` |
| Python | 3.8+ | For Build123d server-side compilation |
| build123d | latest | `pip3 install build123d` |

### Setup

```bash
# 1. Clone
git clone https://github.com/roshaninfordham/paragraphai.git
cd paragraphai

# 2. Install JS dependencies
pnpm install

# 3. Install Python CAD engine
pip3 install build123d

# 4. Configure environment
cp .env.example .env.local
# Edit .env.local — add your API keys (see below)

# 5. Run
pnpm dev
# Open http://localhost:3000
```

### API Keys

| Variable | Where to get it | Used for |
|:---|:---|:---|
| `NVIDIA_API_KEY` | [build.nvidia.com](https://build.nvidia.com) | Nemotron intent parser + Vision |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude tree builder + code gen |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) | Fallback routing + node editing |

---

## Demo

### Preset Prompts (one click in the UI)

| Prompt | What it demonstrates |
|:---|:---|
| `spur gear with 24 teeth, module 2, 5mm bore` | Involute geometry, math, polar arrays |
| `L-bracket 80×60×3mm with 4 mounting holes` | Boolean ops, GridLocations, chamfers |
| `parametric phone stand with 15° viewing angle` | Angle-driven geometry, trig |
| `hex bolt M8×30 with chamfered head` | Thread profile, chamfers, rotational sweep |

### Pipeline Steps (visible live in the UI)

```
1. Intent Parsing   Agent 1 · Nemotron    extracts type, dimensions, features
2. Tree Building    Agent 2 · Claude      builds parametric dependency graph
3. Code Generation  Agent 3 · Claude      writes Build123d Python
4. Compilation      Build123d + Python    executes server-side → STL
5. Scoring          Agent 4 · Deterministic  proportion/symmetry/features/params
```

### Image Upload Flow
1. Click the image icon or paste a photo into the prompt box
2. DIR pipeline classifies geometry family + features via VLM
3. Deterministic prompt assembled from DIR JSON (no hallucination)
4. Full 4-agent pipeline runs on extracted intent

---

## Performance & Cost

| Metric | Value |
|:---|:---|
| End-to-end generation time | ~8–15 seconds |
| Cost per generation | ~$0.006 |
| Nemotron intent parse | ~$0.0001 |
| Claude tree build | ~$0.002 |
| Claude code gen | ~$0.003 |
| Compilation + scoring | $0 (local Python) |
| Build123d primitives | 17 (Box, Cylinder, Sphere, Cone, Torus + boolean ops) |
| DIR geometry families | 7 (revolve, extrude, boxy, cylindrical, gear, bracket, panel) |
| Vision fallback levels | 3 (NVIDIA Vision → Claude Vision → raw text) |

---

## Documentation

| Doc | Description |
|:---|:---|
| [docs/architecture.md](docs/architecture.md) | Agent details, model configs, SSE event flow, DIR schema |
| [docs/dir-pipeline.md](docs/dir-pipeline.md) | Image-to-design pipeline stages, VLM extraction, prompt templates |
| [docs/api-reference.md](docs/api-reference.md) | All endpoints, request/response schemas, SSE event table |
| [CHALLENGES.md](CHALLENGES.md) | 10 technical problems solved during the 48-hour build |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to add agents, primitives, and DIR families |

---

## The Category We're Creating

> **Autonomous Parametric Systems** — applying software engineering principles (version control, diff logs, objective scoring, optimization loops, typed constraints) to geometric design.

Not "AI for 3D." Not a mesh generator. A **goal-driven parametric design engine** where AI handles the geometry and humans handle the intent.

---

## Built At

**Tech@NYU Startup Week 2026 Buildathon** · NVIDIA AI Automation Track · 48 hours

## License

[MIT](LICENSE) © 2026 ParaGraph Team
