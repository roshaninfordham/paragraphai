import { NextRequest, NextResponse } from 'next/server'
import { resilientChat } from '@/lib/llm-clients'

export async function POST(req: NextRequest) {
  const { tree } = await req.json()

  const { text } = await resilientChat(
    [
      {
        role: 'system',
        content: `You are an expert parametric CAD code generator using Build123d (Python). Given a parametric dependency tree, generate Build123d Python code.

RULES:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode)
3. The final shape MUST be assigned to a variable called result
4. DO NOT include any import for export_stl or any export calls
5. DO NOT include any viewer/show calls
6. DO NOT include if __name__ == "__main__" blocks

AVAILABLE BUILD123D PRIMITIVES (positional args ONLY — NEVER use keyword arguments):
- Box(length, width, height) — e.g. Box(80, 60, 10) NOT Box(l=80, w=60, h=10)
- Cylinder(radius, height) — e.g. Cylinder(30, 10) NOT Cylinder(r=30, h=10)
- Sphere(radius) — e.g. Sphere(25)
- Cone(bottom_radius, top_radius, height) — e.g. Cone(20, 10, 30)
- Torus(major_radius, minor_radius) — e.g. Torus(30, 5)

CRITICAL SYNTAX RULES:
- NEVER use keyword arguments for primitives: Cylinder(r=5, h=10) will CRASH. Use Cylinder(5, 10)
- NEVER use .scale() method. Multiply dimensions directly in the constructor instead.
- NEVER use Pos(X=x, Y=y, Z=z). Use Pos(x, y, z) with positional args only.
- NEVER use Rot(X=x, Y=y, Z=z). Use Rot(x, y, z) with positional args only.
- align parameter IS allowed as keyword: Box(10, 10, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))

OPERATIONS:
- Boolean union: shape1 + shape2
- Boolean subtraction: shape1 - shape2
- Boolean intersection: shape1 & shape2
- Fillet: try fillet(edges, radius) with try/except ValueError for safety
- Chamfer: try chamfer(edges, length) with try/except ValueError for safety

POSITIONING:
- Pos(x, y, z) * shape — translate (positional args only)
- Rot(x, y, z) * shape — rotate (positional args only)

IMPORTANT: When using fillet() or chamfer(), always wrap in try/except:
try:
  result = fillet(box.edges(), 2)
except ValueError:
  result = box

Output ONLY valid Python code with no markdown and no backticks.
Brief comments are OK. You have full freedom to use loops, math, and helper functions.`,
      },
      {
        role: 'user',
        content: `Generate Build123d Python code for this parametric design tree:\n${JSON.stringify(tree, null, 2)}\n\nReturn ONLY the Python code, no markdown blocks.`,
      },
    ],
    { maxTokens: 2000, temperature: 0.3, purpose: 'code-generation' }
  )

  let code = text.replace(/```python\n?/g, '').replace(/```\n?/g, '').trim()

  return NextResponse.json({ code })
}
