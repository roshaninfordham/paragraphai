import { NextRequest, NextResponse } from 'next/server'
import { resilientChat } from '@/lib/llm-clients'

export async function POST(req: NextRequest) {
  const { tree } = await req.json()

  const { text } = await resilientChat(
    [
      {
        role: 'system',
        content: `You are a Build123d Python code generator. Given a parametric design tree, generate complete Build123d Python code. Rules:
1. Always use: from build123d import *
2. Use Algebra mode (NOT builder mode)
3. Final shape MUST be assigned to variable called "result"
4. Do NOT include export_stl or any export calls
5. Do NOT include viewer/show calls or if __name__ blocks
6. Generate complete runnable code, no placeholders`,
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
