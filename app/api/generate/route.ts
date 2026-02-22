import { anthropic, nemotronClient, MODELS } from '@/lib/ai-clients'
import { scoreDesign } from '@/lib/scoring'
import type { DesignTree } from '@/lib/types'

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[a-z]*\n?/g, '')
    .replace(/```/g, '')
    .trim()
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(stripMarkdown(text)) as T
  } catch {
    return fallback
  }
}

export async function POST(request: Request) {
  const body = await request.json()
  const prompt: string = body.prompt ?? ''

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(new TextEncoder().encode(sseEvent(data)))
      }

      try {

        // ── AGENT 1: Nemotron Intent Parser ──────────────────
        emit({ type: 'phase', phase: 'parsing' })
        emit({
          type: 'agent_log',
          agent: 'Nemotron',
          message: 'Starting reasoning process...',
        })

        // Use streaming to capture reasoning_content
        const nemotronStream = await nemotronClient.chat.completions.create({
          model: MODELS.nemotron,
          temperature: 0.6,
          top_p: 0.95,
          max_tokens: 2048,
          stream: true,
          messages: [
            {
              role: 'system',
              content: `/no_think`,
            },
            {
              role: 'user',
              content: `You are the Intent Parser agent for ParaGraph, an AI-native parametric 3D design system. You are Step 1 of a 4-agent pipeline.

PIPELINE:
1. YOU (Nemotron) → Extract structured design intent
2. Claude Logic → Build parametric dependency tree  
3. Claude Code → Generate Build123d Python code
4. Scoring Engine → Score deterministically

YOUR TASK: Convert this natural language prompt into structured JSON.

DESIGN TYPES:
- functional_part (brackets, mounts, enclosures)
- decorative_object (vases, sculptures, ornaments)
- mechanical_part (gears, hinges, joints)
- architectural_element (panels, facades, columns)
- enclosure (boxes, cases, housings)

RULES:
- Extract ALL numeric values with units
- Infer reasonable defaults for missing dimensions
- Keep parameter keys lowercase with underscores
- Always include at least 3 parameters

PROMPT TO PARSE:
"${prompt}"`,
            },
          ],
          extra_body: {
            guided_json: {
              type: "object",
              properties: {
                entities: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  description: "Primary object names"
                },
                parameters: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      value: { type: "number" },
                      unit: { type: "string" }
                    },
                    required: ["key", "value", "unit"]
                  },
                  minItems: 1,
                  description: "Design parameters with values and units"
                },
                relationships: {
                  type: "array",
                  items: { type: "string" },
                  description: "Spatial relationship descriptions"
                },
                designType: {
                  type: "string",
                  enum: ["functional_part", "decorative_object", "mechanical_part", "architectural_element", "enclosure"],
                  description: "Category of the design"
                },
                qualitative_goals: {
                  type: "array",
                  items: { type: "string" },
                  description: "Qualitative design goals"
                },
                constraints: {
                  type: "array",
                  items: { type: "string" },
                  description: "Specific requirements or constraints"
                }
              },
              required: ["entities", "parameters", "designType"]
            }
          }
        } as any)

        // Collect streaming response
        let intentText = ''
        let reasoningText = ''
        let chunkCount = 0

        for await (const chunk of nemotronStream as AsyncIterable<{
          choices: Array<{
            delta: {
              content?: string
              reasoning_content?: string
            }
          }>
        }>) {
          const reasoning = chunk.choices[0]?.delta?.reasoning_content
          const content = chunk.choices[0]?.delta?.content

          if (reasoning) {
            reasoningText += reasoning
            // Emit reasoning trace every ~100 chars so UI updates smoothly
            if (reasoningText.length % 100 < 20) {
              emit({
                type: 'nemotron_thinking',
                text: reasoningText.slice(-200), // last 200 chars
              })
            }
          }

          if (content) {
            intentText += content
            chunkCount++
          }
        }

        // Emit final reasoning summary
        if (reasoningText) {
          emit({
            type: 'agent_log',
            agent: 'Nemotron',
            message: `Reasoned for ${reasoningText.split(' ').length} words → extracting parameters`,
          })
          emit({
            type: 'nemotron_reasoning_done',
            summary: reasoningText.slice(0, 300),
          })
        }

        const intentResult = parseJSON(intentText.trim(), {
          entities: ['object'],
          parameters: [{ key: 'height', value: 100, unit: 'mm' }],
          relationships: [],
          designType: 'functional_part',
          qualitative_goals: [],
          constraints: [],
        })

        emit({ type: 'agent_done', agent: 'Nemotron', tokens: intentText.split(' ').length * 1.3 | 0, cost: 0.0001 })
        emit({ type: 'intent', data: intentResult })
        emit({
          type: 'agent_log',
          agent: 'Nemotron',
          message: (() => {
            const paramCount = Array.isArray(intentResult.parameters) ? intentResult.parameters.length : Object.keys(intentResult.parameters || {}).length
            const goalCount = Array.isArray(intentResult.qualitative_goals) ? intentResult.qualitative_goals.length : 0
            return `Identified: ${intentResult.designType ?? intentResult.entities?.[0] ?? 'object'} — ${paramCount} parameters, ${goalCount} goals`
          })(),
        })

        // ── AGENT 2: Claude Logic Tree Builder ───────────────
        emit({ type: 'phase', phase: 'building-tree' })
        emit({
          type: 'agent_log',
          agent: 'Claude Logic',
          message: 'Building parametric dependency tree...',
        })

        const treeRes = await anthropic.messages.create({
          model: MODELS.claude,
          max_tokens: 2000,
          system: `You are a parametric CAD logic tree builder. Convert design intent into a structured dependency tree. Respond with ONLY valid JSON, no markdown, no backticks, no explanation.

The JSON must match this exact structure:
{
  "design_id": "unique-id-string",
  "name": "descriptive name",
  "prompt": "original prompt here",
  "parameters": {
    "height": {"key":"height","value":200,"unit":"mm","min":50,"max":500,"locked":false},
    "radius": {"key":"radius","value":30,"unit":"mm","min":10,"max":200,"locked":false}
  },
  "nodes": {
    "body": {"id":"body","op":"cylinder","label":"Main Body","params":{"h":"height","r":"radius"},"children":[],"depends_on":["height","radius"]},
    "root": {"id":"root","op":"union","label":"Final Shape","params":{},"children":["body"],"depends_on":[]}
  },
  "root_id": "root",
  "created_at": 0
}

Rules:
- 3 to 12 nodes maximum
- op must be one of: cube, sphere, cylinder, cone, torus, union, difference, intersection, translate, rotate, scale, fillet, chamfer, linear_extrude, rotate_extrude, pattern_linear, pattern_polar
- depends_on lists parameter keys the node uses
- children lists node IDs that are direct children
- all parameters need realistic min/max bounds
- created_at must be 0 (will be set by server)`,
          messages: [
            {
              role: 'user',
              content: `Design intent: ${JSON.stringify(intentResult)}
Original prompt: "${prompt}"

Generate the DesignTree JSON:`,
            },
          ],
        })

        const treeText =
          treeRes.content[0]?.type === 'text'
            ? treeRes.content[0].text
            : '{}'

        const rawTree = parseJSON<DesignTree>(treeText, {
          design_id: crypto.randomUUID(),
          name: prompt.slice(0, 40),
          prompt,
          parameters: {},
          nodes: {},
          root_id: 'root',
          created_at: Date.now(),
        })

        const designTree: DesignTree = {
          ...rawTree,
          design_id: rawTree.design_id || crypto.randomUUID(),
          created_at: Date.now(),
        }

        emit({ type: 'agent_done', agent: 'Claude Logic', tokens: treeText.length / 4 | 0, cost: (treeText.length / 4) * 0.000003 })
        emit({ type: 'tree', data: designTree })
        emit({
          type: 'agent_log',
          agent: 'Claude Logic',
          message: `Tree built: ${Object.keys(designTree.nodes).length} nodes, ${Object.keys(designTree.parameters).length} parameters`,
        })

        // ── AGENT 3: Claude Code Generator ───────────────────
        emit({ type: 'phase', phase: 'generating-code' })
        emit({
          type: 'agent_log',
          agent: 'Claude Code',
          message: 'Generating Build123d code from dependency tree...',
        })

        const codeRes = await anthropic.messages.create({
          model: MODELS.claude,
          max_tokens: 2000,
          system: `You are an expert parametric CAD code generator using Build123d (Python). Given a parametric dependency tree, generate Build123d Python code that creates the described 3D model.

RULES:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode) — it's cleaner and more composable
3. The final shape MUST be assigned to a variable called \`result\`
4. All dimensions should use the parametric values from the tree
5. DO NOT include any import for export_stl or any export calls — that is handled automatically
6. DO NOT include any viewer/show calls
7. DO NOT include if __name__ == "__main__" blocks

AVAILABLE BUILD123D PRIMITIVES:
- Box(length, width, height) — rectangular box centered at origin
- Cylinder(radius, height) — cylinder centered at origin
- Sphere(radius) — sphere at origin
- Cone(bottom_radius, top_radius, height) — cone/frustum
- Torus(major_radius, minor_radius) — torus

OPERATIONS:
- Fillet: fillet(edges, radius) — e.g. result = fillet(box.edges(), 2)
- Chamfer: chamfer(edges, length) — e.g. result = chamfer(box.edges(), 1)
- Boolean union: shape1 + shape2
- Boolean subtraction: shape1 - shape2
- Boolean intersection: shape1 & shape2
- Extrude: extrude(sketch, amount)
- Revolve: revolve(sketch, axis, arc)

POSITIONING:
- Pos(X=x, Y=y, Z=z) * shape — translate
- Rot(X=rx, Y=ry, Z=rz) * shape — rotate
- Locations: for loc in GridLocations(x_spacing, y_spacing, x_count, y_count): ...
- PolarLocations(radius, count) — for circular patterns

IMPORTANT: The variable MUST be called \`result\`. This is non-negotiable.
Always generate complete, runnable Build123d code. Never use placeholders.
IMPORTANT: When using fillet() or chamfer(), always use try/except to catch failures and fall back to the unfilleted shape. Fillet radii that are too large for small edges will crash. Example: try:\n  result = fillet(box.edges(), 2)\nexcept ValueError:\n  result = box
Output ONLY valid Python code with no markdown and no backticks.
Brief comments are OK. You have full freedom to use loops, math, helper functions, and trigonometry to create complex geometry like gear teeth, patterns, organic shapes, and involute profiles. Do not simplify — generate the most accurate geometry possible.

EXAMPLE — Spur gear with involute teeth:
from build123d import *
import math
module = 2
teeth = 20
pitch_r = module * teeth / 2
outer_r = pitch_r + module
root_r = pitch_r - 1.25 * module
thickness = 10
bore_r = 5
# Create gear body
body = Cylinder(outer_r, thickness)
# Subtract root between teeth using polar subtraction
for i in range(teeth):
    angle = i * 360 / teeth
    slot = Pos(0, 0, 0) * Rot(0, 0, angle) * Pos(pitch_r, 0, 0) * Box(module * 1.2, module * 2.5, thickness + 2)
    body = body - slot
# Center bore
body = body - Cylinder(bore_r, thickness + 2)
result = body

EXAMPLE — Box with fillets and holes:
from build123d import *
box = Box(80, 60, 10)
box = fillet(box.edges(), 2)
box = box - Pos(30, 20, 0) * Cylinder(3, 20)
box = box - Pos(-30, -20, 0) * Cylinder(3, 20)
result = box

EXAMPLE — Ribbed vase:
from build123d import *
import math
height = 200
base_r = 30
ribs = 12
body = Cylinder(base_r, height)
for i in range(ribs):
    angle = i * 360 / ribs
    rib = Pos(0, 0, 0) * Rot(0, 0, angle) * Pos(base_r, 0, height/2) * Box(3, 6, height)
    body = body + rib
body = body - Cylinder(base_r - 3, height - 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
result = body`,
          messages: [
            {
              role: 'user',
              content: `Generate Build123d Python code for this design tree:
${JSON.stringify(designTree, null, 2)}`,
            },
          ],
        })

        const rawCode =
          codeRes.content[0]?.type === 'text'
            ? codeRes.content[0].text
            : 'from build123d import *\nresult = Box(10, 10, 10)'

        const build123dCode = stripMarkdown(rawCode)

        emit({ type: 'agent_done', agent: 'Claude Code', tokens: rawCode.length / 4 | 0, cost: (rawCode.length / 4) * 0.000003 })
        emit({ type: 'code', data: build123dCode })
        emit({
          type: 'agent_log',
          agent: 'Claude Code',
          message: `Generated ${build123dCode.split('\n').length} lines of Build123d code`,
        })

        // ── SCORING ───────────────────────────────────────────
        emit({ type: 'phase', phase: 'scoring' })

        const scores = scoreDesign(designTree, prompt)

        emit({ type: 'scores', data: scores })
        emit({
          type: 'agent_log',
          agent: 'Scoring',
          message: `Score: ${scores.overall.toFixed(2)} — proportion:${scores.proportion.toFixed(2)} symmetry:${scores.symmetry.toFixed(2)} features:${scores.featureCount.toFixed(2)}`,
        })

        // ── DONE ──────────────────────────────────────────────
        emit({ type: 'phase', phase: 'done' })

      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        controller.enqueue(
          new TextEncoder().encode(
            sseEvent({ type: 'error', message })
          )
        )
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
