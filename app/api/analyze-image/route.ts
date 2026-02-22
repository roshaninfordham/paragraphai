import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'

/* ── Stage 1.1: Image Preprocessing (cofounder spec) ───────────── */

async function preprocessImage(base64: string, mimeType: string): Promise<{ base64: string; mime: string; width: number; height: number }> {
  const buffer = Buffer.from(base64, 'base64')

  // Resize to max 1024px, convert to JPEG for smaller payload
  const processed = await sharp(buffer)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  const metadata = await sharp(buffer).metadata()

  return {
    base64: processed.toString('base64'),
    mime: 'image/jpeg',
    width: metadata.width || 0,
    height: metadata.height || 0,
  }
}

/* ── Inlined DIR types ─────────────────────────────────────────── */

interface DIRFeature {
  type: string
  likelihood: number
  count_estimate?: number
  direction?: string
}

interface DIR {
  family: string
  confidence: number
  global: {
    height_width_ratio: number
    symmetry: { type: string; score: number }
    orientation: string
    detail_level: number
  }
  shape: {
    taper_ratio: number
    roundness: number
    rectangularity: number
    hollow_likelihood: number
  }
  features: DIRFeature[]
  constraints_suggestions: {
    prefer_symmetry_axis: string
    size_hint_mm: Record<string, number>
  }
}

/* ── Inlined parseDIR ──────────────────────────────────────────── */

function parseDIR(text: string): DIR | null {
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!parsed.family || !parsed.global) return null
    return parsed as DIR
  } catch {
    return null
  }
}

/* ── Inlined dirToPrompt ───────────────────────────────────────── */

function dirToPrompt(dir: DIR): string {
  const parts: string[] = []
  const fam: Record<string, string> = {
    revolve_profile: 'revolved profile shape (like a vase or bottle)',
    extrude_profile: 'extruded profile shape (like a plate or bracket)',
    boxy_enclosure: 'rectangular enclosure box',
    cylindrical_part: 'cylindrical part',
    panel_pattern: 'flat panel with pattern',
    gear_mechanism: 'gear mechanism',
    bracket_mount: 'mounting bracket',
    unknown: '3D object',
  }
  parts.push('Create a ' + (fam[dir.family] || dir.family) + '.')

  const h = dir.constraints_suggestions?.size_hint_mm || {}
  if (h.height) parts.push('Target height: ' + h.height + 'mm.')
  if (h.width) parts.push('Target width: ' + h.width + 'mm.')
  if (h.diameter) parts.push('Target diameter: ' + h.diameter + 'mm.')
  if (h.thickness) parts.push('Thickness: ' + h.thickness + 'mm.')

  if (dir.global?.height_width_ratio > 0)
    parts.push('Height-to-width ratio approximately ' + dir.global.height_width_ratio.toFixed(1) + '.')

  if (dir.global?.symmetry?.score > 0.7) {
    if (dir.global.symmetry.type.includes('radial') || dir.global.symmetry.type.includes('rotational'))
      parts.push('Radially symmetric around the central axis.')
    else
      parts.push('Mirror symmetry should be high.')
  }

  if (dir.shape?.taper_ratio > 0 && dir.shape.taper_ratio < 0.8)
    parts.push('Tapers toward the top with taper ratio ~' + dir.shape.taper_ratio.toFixed(2) + '.')
  if (dir.shape?.hollow_likelihood > 0.5)
    parts.push('The object appears hollow — include wall thickness and interior cavity.')
  if (dir.shape?.roundness > 0.7)
    parts.push('Predominantly round/circular cross-section.')
  else if (dir.shape?.rectangularity > 0.7)
    parts.push('Predominantly rectangular/boxy cross-section.')

  for (const f of dir.features || []) {
    if (f.likelihood < 0.4) continue
    switch (f.type) {
      case 'ribs': parts.push('Add ' + (f.count_estimate ?? 'several') + ' ' + (f.direction ?? 'vertical') + ' ribs evenly spaced.'); break
      case 'teeth': parts.push('Include ' + (f.count_estimate ?? 20) + ' gear teeth evenly distributed.'); break
      case 'holes': parts.push('Add ' + (f.count_estimate ?? 4) + ' mounting holes.'); break
      case 'bore': parts.push('Include a center bore hole.'); break
      case 'fillet': parts.push('Apply fillets to edges.'); break
      case 'chamfer': parts.push('Apply chamfers to exposed edges.'); break
      case 'slots': parts.push('Include ventilation slots.'); break
      case 'pattern': parts.push('Add a repeating ' + (f.direction ?? 'surface') + ' pattern.'); break
      default: parts.push('Include ' + f.type + ' feature.')
    }
  }

  if (dir.constraints_suggestions?.prefer_symmetry_axis)
    parts.push('Prefer ' + dir.constraints_suggestions.prefer_symmetry_axis + '-axis as primary symmetry axis.')
  if (dir.global?.detail_level > 0.7)
    parts.push('The model should be detailed with precise geometry.')

  return parts.join(' ')
}

/* ── VLM prompt ────────────────────────────────────────────────── */

const DIR_PROMPT = [
  'You are an expert 3D CAD vision analyst. Analyze this image and output a Design Intent Representation (DIR) as JSON.',
  '',
  'Respond with ONLY valid JSON matching this schema — no markdown fences, no explanation:',
  '',
  '{',
  '  "family": "revolve_profile" | "extrude_profile" | "boxy_enclosure" | "cylindrical_part" | "panel_pattern" | "gear_mechanism" | "bracket_mount" | "unknown",',
  '  "confidence": 0.0 to 1.0,',
  '  "global": {',
  '    "height_width_ratio": number,',
  '    "symmetry": { "type": "mirror_y" | "radial" | "rotational" | "asymmetric", "score": 0.0 to 1.0 },',
  '    "orientation": "upright" | "horizontal" | "angled",',
  '    "detail_level": 0.0 to 1.0',
  '  },',
  '  "shape": {',
  '    "taper_ratio": 0.0 to 1.0,',
  '    "roundness": 0.0 to 1.0,',
  '    "rectangularity": 0.0 to 1.0,',
  '    "hollow_likelihood": 0.0 to 1.0',
  '  },',
  '  "features": [',
  '    { "type": "ribs"|"teeth"|"holes"|"bore"|"fillet"|"chamfer"|"slots"|"pattern", "likelihood": 0.0-1.0, "count_estimate": int|null, "direction": "vertical"|"horizontal"|"radial"|null }',
  '  ],',
  '  "constraints_suggestions": {',
  '    "prefer_symmetry_axis": "Z"|"Y"|"X",',
  '    "size_hint_mm": { "height": number, "width": number, "diameter": number, "thickness": number }',
  '  }',
  '}',
  '',
  'RULES:',
  '- Estimate ALL numeric values from visual appearance',
  '- For size_hint_mm estimate real-world mm dimensions',
  '- Include ALL visible features with likelihood scores',
  '- Output ONLY the JSON object',
].join('\n')

const DIR_SCHEMA_PROMPT = `You are an expert 3D CAD vision analyst for ParaGraph, an AI parametric design system. Analyze this image and output a structured Design Intent Representation (DIR) as JSON.

You MUST respond with ONLY a valid JSON object matching this exact schema — no markdown, no explanation, no preamble:

{
  "family": one of "revolve_profile" | "extrude_profile" | "boxy_enclosure" | "cylindrical_part" | "panel_pattern" | "gear_mechanism" | "bracket_mount" | "unknown",
  "confidence": 0.0 to 1.0,
  "global": {
    "height_width_ratio": number (estimate from visible proportions),
    "symmetry": { "type": "mirror_y" | "radial" | "rotational" | "asymmetric", "score": 0.0 to 1.0 },
    "orientation": "upright" | "horizontal" | "angled",
    "detail_level": 0.0 to 1.0 (0 = very simple, 1 = very detailed)
  },
  "shape": {
    "taper_ratio": 0.0 to 1.0 (top_width / bottom_width, 1.0 = no taper),
    "roundness": 0.0 to 1.0 (how circular the cross-section appears),
    "rectangularity": 0.0 to 1.0 (how rectangular/boxy),
    "hollow_likelihood": 0.0 to 1.0 (probability the object is hollow)
  },
  "features": [
    { "type": "ribs" | "teeth" | "holes" | "bore" | "fillet" | "chamfer" | "slots" | "pattern", "likelihood": 0.0 to 1.0, "count_estimate": integer or null, "direction": "vertical" | "horizontal" | "radial" | null }
  ],
  "constraints_suggestions": {
    "prefer_symmetry_axis": "Z" | "Y" | "X",
    "size_hint_mm": { "height": number, "width": number, "diameter": number, "thickness": number }
  }
}

RULES:
- Estimate ALL numeric values from visual appearance — do not leave them as 0 or null if you can make a reasonable guess
- For size_hint_mm, estimate real-world dimensions in millimeters based on what the object appears to be
- Include ALL visible features in the features array with likelihood scores
- The family classification is critical — choose the best match from the available options
- Output ONLY the JSON object, nothing else`

/* ── Vision strategies ─────────────────────────────────────────── */

async function tryNvidia(b64: string, mime: string): Promise<string | null> {
  try {
    const c = new OpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.NVIDIA_API_KEY! })
    const r = await c.chat.completions.create({
      model: 'nvidia/nemotron-nano-12b-v2-vl',
      max_tokens: 1024, temperature: 0.3, stream: false,
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } },
        { type: 'text', text: DIR_PROMPT },
      ]}],
    } as any)
    const t = r.choices[0]?.message?.content?.trim()
    return (t && t.length > 20) ? t : null
  } catch (e: any) { console.error('[analyze-image] NVIDIA fail:', e.message); return null }
}

async function tryClaude(b64: string, mime: string): Promise<string | null> {
  try {
    const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const r = await c.messages.create({
      model: 'claude-sonnet-4-5-20250929', max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime as any, data: b64 } },
        { type: 'text', text: DIR_PROMPT },
      ]}],
    })
    return r.content[0]?.type === 'text' ? r.content[0].text.trim() : null
  } catch (e: any) { console.error('[analyze-image] Claude fail:', e.message); return null }
}

/* ── Handler ───────────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType } = await req.json()
    if (!imageBase64) return NextResponse.json({ error: 'No image provided' }, { status: 400 })

    // Stage 1.1: Preprocess image (resize, normalize, compress)
    console.log('[analyze-image] Preprocessing image...')
    const img = await preprocessImage(imageBase64, mimeType || 'image/png')
    console.log('[analyze-image] Preprocessed: ' + img.width + 'x' + img.height + ' -> JPEG ' + (img.base64.length / 1024).toFixed(0) + 'KB')

    // Stage 2: VLM extracts DIR
    console.log('[analyze-image] Trying NVIDIA Vision...')
    let raw = await tryNvidia(img.base64, img.mime)
    let model = 'nvidia/nemotron-nano-12b-v2-vl'

    if (!raw) {
      console.log('[analyze-image] Falling back to Claude Vision...')
      raw = await tryClaude(img.base64, img.mime)
      model = 'claude-sonnet-4-5'
    }

    if (!raw) return NextResponse.json({ error: 'Both vision models failed' }, { status: 500 })

    const dir = parseDIR(raw)
    if (!dir) {
      console.log('[analyze-image] DIR parse failed, using raw text')
      return NextResponse.json({ description: raw, dir: null, model })
    }

    const description = dirToPrompt(dir)
    console.log('[analyze-image] DIR: family=' + dir.family + ' conf=' + dir.confidence)

    return NextResponse.json({ description, dir, model })
  } catch (e: any) {
    console.error('[analyze-image] Error:', e.message)
    return NextResponse.json({ error: e.message || 'Image analysis failed' }, { status: 500 })
  }
}
