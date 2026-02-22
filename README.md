# ParaGraph — AI-Native Parametric Design Studio

> **The future of AI-native parametric design for everyone.**

ParaGraph is an autonomous parametric 3D design system. Users describe any 3D object in natural language — or drop an image — and a multi-agent AI pipeline generates editable parametric CAD code, compiles it to STL, and renders it in a real-time 3D viewport.

We don't generate static meshes. **We generate editable parametric systems that can improve themselves.**

![ParaGraph Demo](docs/demo-screenshot.png)

---

## What Makes It Different

| Traditional AI 3D Tools | ParaGraph |
|---|---|
| Generate static meshes | Generate **editable parametric systems** |
| Black box — no explanation | Every change is **logged, explained, reversible** |
| One-shot generation | **Autonomous iteration** with scoring feedback |
| Manual editing only | **Natural language editing** of any parameter |
| No quality measurement | **Objective scoring** — proportion, symmetry, features |

---

## Architecture

### Multi-Agent Pipeline

```
User Input (text or image)
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  AGENT 1: Nemotron (NVIDIA NIM)                     │
│  Intent Parser — NL/Image → structured parameters   │
│  • guided_json constrained decoding                 │
│  • Design Intent Representation (DIR) for images    │
└──────────────────────┬──────────────────────────────┘
                       │ Structured JSON
                       ▼
┌─────────────────────────────────────────────────────┐
│  AGENT 2: Claude Logic (Anthropic)                  │
│  Tree Builder — parameters → parametric dep. graph  │
│  • 3-12 nodes with typed operations                 │
│  • Parameter dependency tracking                    │
└──────────────────────┬──────────────────────────────┘
                       │ DesignTree JSON
                       ▼
┌─────────────────────────────────────────────────────┐
│  AGENT 3: Claude Code (Anthropic)                   │
│  Code Generator — tree → Build123d Python           │
│  • Full freedom: loops, math, trig, helpers         │
│  • OpenCascade BREP kernel (engineering-grade)      │
└──────────────────────┬──────────────────────────────┘
                       │ Python code
                       ▼
┌─────────────────────────────────────────────────────┐
│  BUILD123D COMPILER                                 │
│  Python → STL binary (server-side execution)        │
│  • OpenCascade kernel (same as FreeCAD/SolidWorks)  │
│  • BREP: fillets, booleans, extrusions, chamfers    │
└──────────────────────┬──────────────────────────────┘
                       │ Binary STL
                       ▼
┌─────────────────────────────────────────────────────┐
│  AGENT 4: Scoring Engine (Deterministic)            │
│  Evaluates: proportion, symmetry, features, params  │
│  • No LLM — pure math, repeatable, fast             │
│  • Drives autonomous iteration loop                 │
└─────────────────────────────────────────────────────┘
```

### Image-to-Design Pipeline (DIR)

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

| Layer | Technology | Role |
|---|---|---|
| **Frontend** | Next.js 16, TypeScript, Tailwind CSS | App framework |
| **3D Viewport** | Babylon.js | Real-time STL rendering |
| **Node Graph** | React Flow | Parametric dependency visualization |
| **State** | Zustand | Client-side state management |
| **Layout** | react-resizable-panels | Resizable viewport/graph panels |
| **Intent Parsing** | NVIDIA Nemotron (NIM API) | NL → structured design parameters |
| **Tree Building** | Claude Sonnet 4.5 (Anthropic) | Parameters → parametric graph |
| **Code Generation** | Claude Sonnet 4.5 (Anthropic) | Graph → Build123d Python |
| **Image Analysis** | Nemotron Vision + Claude Vision | Image → DIR JSON |
| **Image Preprocessing** | sharp | Resize, normalize, compress |
| **CAD Engine** | Build123d (OpenCascade/Python) | BREP parametric modeling → STL |
| **Scoring** | Deterministic (no LLM) | Objective quality evaluation |
| **Constrained Decoding** | NVIDIA NIM guided_json | Guaranteed valid JSON from Nemotron |

---

## Features

- **Natural Language → 3D**: Type a description, get a parametric model
- **Image → 3D**: Drop/paste any image, AI extracts design intent via DIR pipeline
- **4-Agent Pipeline**: Observable multi-agent collaboration with live timers
- **Parametric Editing**: Click any node, describe changes in words
- **Version History**: Full design lineage, any version restorable
- **STL Export**: Download models for 3D printing or use in any CAD software
- **Pipeline Report**: Download Markdown breakdown of costs, times, and scores
- **Scoring System**: Proportion, symmetry, features, parameters — with info tooltips
- **Iteration Loop**: Step / Run ×3 / Auto → target score
- **Engineering-Grade Geometry**: OpenCascade kernel — fillets, booleans, chamfers

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

- Node.js 18+
- Python 3.8+ with `build123d` installed (`pip3 install build123d`)
- pnpm

### Environment Variables

Create `.env.local`:

```bash
NVIDIA_API_KEY=nvapi-...        # NVIDIA NIM API key (Nemotron)
ANTHROPIC_API_KEY=sk-ant-...    # Anthropic API key (Claude)
OPENROUTER_API_KEY=sk-or-v1-... # OpenRouter API key (fallback)
```

### Run

```bash
pnpm install
pnpm dev
# Open http://localhost:3000
```

---

## Demo

1. **Text → 3D**: Click "Spur Gear" → watch 4 agents activate → gear renders
2. **Image → 3D**: Drop a photo of a gear → DIR extraction → parametric model
3. **Edit**: Click a node → type "double the teeth" → model updates
4. **Export**: Click "DL STL" → open in any CAD software
5. **Report**: Click "Download Report" → full pipeline breakdown

---

## Cost Efficiency

~$0.006 per complete design generation (Nemotron + Claude + Claude)

---

## The Category We're Creating

**Autonomous Parametric Systems / Goal-Driven CAD**

Not "AI for 3D." But: applying software engineering principles — version control, diff logs, objective scoring, optimization loops, constraints — to geometric design.

---

## Team

Built at Tech@NYU Startup Week 2026 Buildathon — NVIDIA AI Automation Track

## License

MIT
