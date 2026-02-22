import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { writeFile, readFile, unlink, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Find python3 binary
const PYTHON_PATHS = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3']
let resolvedPython: string | null | undefined = undefined

async function findPython(): Promise<string | null> {
  if (resolvedPython !== undefined) return resolvedPython
  for (const p of PYTHON_PATHS) {
    try {
      const { stdout } = await execFileAsync(p, ['--version'], { timeout: 5000 })
      console.log(`[compile] Found Python at: ${p} — ${stdout.trim()}`)
      resolvedPython = p
      return p
    } catch {}
  }
  resolvedPython = null
  return null
}

// Verify build123d is installed
let build123dVerified = false
async function verifyBuild123d(python: string): Promise<boolean> {
  if (build123dVerified) return true
  try {
    await execFileAsync(python, ['-c', 'import build123d; print("ok")'], { timeout: 10000 })
    console.log('[compile] build123d verified')
    build123dVerified = true
    return true
  } catch (err: any) {
    console.error('[compile] build123d not installed:', err.stderr || err.message)
    return false
  }
}

export async function POST(req: NextRequest) {
  let code: string

  try {
    const body = await req.json()
    code = body.code
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing "code" in body' }, { status: 400 })
  }

  console.log(`[compile] Received ${code.length} chars of Build123d code`)
  console.log(`[compile] First 300 chars:\n${code.substring(0, 300)}`)

  const python = await findPython()
  if (!python) {
    return NextResponse.json({ error: 'Python not found. Install Python 3.8+.' }, { status: 501 })
  }

  const hasBuild123d = await verifyBuild123d(python)
  if (!hasBuild123d) {
    return NextResponse.json({
      error: 'build123d not installed. Run: pip3 install build123d',
    }, { status: 501 })
  }

  const id = randomUUID()
  const pyPath = join(tmpdir(), `paragraph-${id}.py`)
  const stlPath = join(tmpdir(), `paragraph-${id}.stl`)

  try {
    // Wrap the user code to ensure STL export happens
    // The AI-generated code should define a variable called `result` as the final shape
    // We append export logic that finds the shape and exports it
    const wrappedCode = `
import sys
import os

# User-generated Build123d code
${code}

# ── Auto-export to STL ──────────────────────────────────
from build123d import export_stl, Compound, Part, Solid, Shape

_stl_path = "${stlPath.replace(/\\/g, '/')}"

# Try to find the result shape — check common variable names
_shape = None
for _name in ['result', 'part', 'model', 'final', 'output', 'design']:
    if _name in dir() and _name in locals():
        _obj = locals()[_name]
        if hasattr(_obj, 'part'):
            _shape = _obj.part  # BuildPart context
            break
        elif isinstance(_obj, (Solid, Compound, Shape)):
            _shape = _obj
            break

# If nothing found, check for BuildPart contexts
if _shape is None:
    for _name, _obj in list(locals().items()):
        if _name.startswith('_'):
            continue
        if hasattr(_obj, 'part') and _obj.part is not None:
            _shape = _obj.part
            break
        if isinstance(_obj, (Solid, Compound)):
            _shape = _obj
            break

if _shape is None:
    print("ERROR: No shape found to export. Define a variable called 'result' with your final shape.", file=sys.stderr)
    sys.exit(1)

export_stl(_shape, _stl_path)
print(f"Exported STL to {_stl_path}")
`

    await writeFile(pyPath, wrappedCode, 'utf-8')
    console.log(`[compile] Wrote Python file: ${pyPath}`)

    // Run the Python script
    const { stdout, stderr } = await execFileAsync(
      python,
      [pyPath],
      {
        timeout: 60_000,  // Build123d can be slower than OpenSCAD for complex shapes
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      }
    )

    if (stdout) console.log('[compile] stdout:', stdout.trim())
    if (stderr) console.log('[compile] stderr:', stderr.trim())

    // Check if STL was created
    try {
      const stlStat = await stat(stlPath)
      console.log(`[compile] STL file size: ${stlStat.size} bytes`)
    } catch {
      return NextResponse.json({
        error: 'Build123d produced no STL output. Check code for errors.',
        stderr: stderr || undefined,
      }, { status: 422 })
    }

    const stlBuffer = await readFile(stlPath)
    console.log(`[compile] Returning ${stlBuffer.byteLength} bytes of STL`)

    await unlink(pyPath).catch(() => {})
    await unlink(stlPath).catch(() => {})

    return new Response(stlBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stlBuffer.byteLength),
      },
    })

  } catch (err: any) {
    console.error('[compile] Build123d execution failed:')
    console.error('[compile] stderr:', err.stderr)
    console.error('[compile] message:', err.message)

    const errorMsg = err.stderr || err.message || 'Compilation failed'

    // Auto-heal: if fillet/chamfer failed, retry without them
    if (errorMsg.includes('fillet') || errorMsg.includes('chamfer') || errorMsg.includes('Failed creating a fillet') || errorMsg.includes('BRep_API: command not done')) {
      console.log('[compile] Fillet/chamfer error detected — retrying without fillets...')

      try {
        // Remove fillet and chamfer lines from the code
        const healedCode = code
          .split('\n')
          .filter(line => {
            const trimmed = line.trim().toLowerCase()
            return !trimmed.includes('fillet(') && !trimmed.includes('chamfer(') && !trimmed.includes('= fillet(') && !trimmed.includes('= chamfer(')
          })
          .join('\n')

        const healedWrapped = `
import sys
import os

# User-generated Build123d code (auto-healed: fillets/chamfers removed)
${healedCode}

# ── Auto-export to STL ──────────────────────────────────
from build123d import export_stl, Compound, Part, Solid, Shape

_stl_path = "${stlPath.replace(/\\/g, '/')}"

_shape = None
for _name in ['result', 'part', 'model', 'final', 'output', 'design']:
    if _name in dir() and _name in locals():
        _obj = locals()[_name]
        if hasattr(_obj, 'part'):
            _shape = _obj.part
            break
        elif isinstance(_obj, (Solid, Compound, Shape)):
            _shape = _obj
            break

if _shape is None:
    for _name, _obj in list(locals().items()):
        if _name.startswith('_'):
            continue
        if hasattr(_obj, 'part') and _obj.part is not None:
            _shape = _obj.part
            break
        if isinstance(_obj, (Solid, Compound)):
            _shape = _obj
            break

if _shape is None:
    print("ERROR: No shape found to export.", file=sys.stderr)
    sys.exit(1)

export_stl(_shape, _stl_path)
print(f"Exported STL to {_stl_path} (auto-healed)")
`

        const healedPyPath = join(tmpdir(), 'paragraph-healed-' + id + '.py')
        await writeFile(healedPyPath, healedWrapped, 'utf-8')

        const { stdout: hStdout, stderr: hStderr } = await execFileAsync(
          python,
          [healedPyPath],
          {
            timeout: 60_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
          }
        )

        if (hStdout) console.log('[compile] healed stdout:', hStdout.trim())
        if (hStderr) console.log('[compile] healed stderr:', hStderr.trim())

        try {
          await stat(stlPath)
        } catch {
          await unlink(healedPyPath).catch(() => {})
          return NextResponse.json({ error: 'Auto-heal also failed: ' + (hStderr || 'no STL produced') }, { status: 422 })
        }

        const stlBuffer = await readFile(stlPath)
        console.log('[compile] Auto-healed successfully! Returning ' + stlBuffer.byteLength + ' bytes (fillets removed)')

        await unlink(healedPyPath).catch(() => {})
        await unlink(pyPath).catch(() => {})
        await unlink(stlPath).catch(() => {})

        return new Response(stlBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(stlBuffer.byteLength),
          },
        })
      } catch (healErr: any) {
        console.error('[compile] Auto-heal retry also failed:', healErr.message)
        return NextResponse.json({ error: errorMsg }, { status: 422 })
      }
    }

    return NextResponse.json({ error: errorMsg }, { status: 422 })
  } finally {
    await unlink(pyPath).catch(() => {})
    await unlink(stlPath).catch(() => {})
  }
}
