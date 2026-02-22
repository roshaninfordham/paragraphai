import type { DesignTree, ScoreResult } from '@/lib/types'

// ─── Main Scoring Function (Hybrid: BREP Geometry + Tree Analysis) ─────
export function scoreDesign(
  tree: DesignTree,
  prompt: string,
  geometryMetrics?: any
): ScoreResult {
  // If we have real BREP metrics, use geometry-aware scoring
  const hasMetrics = geometryMetrics && !geometryMetrics.error

  const proportion = hasMetrics
    ? scoreProportionFromGeometry(geometryMetrics, tree, prompt)
    : scoreProportionFromTree(tree)

  const symmetry = hasMetrics
    ? scoreSymmetryFromGeometry(geometryMetrics, prompt)
    : scoreSymmetryFromTree(tree, prompt)

  const featureCount = hasMetrics
    ? scoreFeaturesFromGeometry(geometryMetrics, tree, prompt)
    : scoreFeaturesFromTree(tree, prompt)

  const parameterRange = scoreParameterRange(tree)

  // Validity gate: if BREP is invalid, cap overall score
  const validityPenalty = (hasMetrics && !geometryMetrics.is_valid) ? 0.5 : 1.0

  const overall = round(
    (proportion * 0.25 + symmetry * 0.2 + featureCount * 0.3 + parameterRange * 0.25) * validityPenalty
  )

  const breakdown: string[] = []
  if (hasMetrics && !geometryMetrics.is_valid)
    breakdown.push('BREP topology is invalid — model may have geometric errors')
  if (proportion < 0.6)
    breakdown.push('Proportions need adjustment — edit blue PARAM nodes')
  if (symmetry < 0.6)
    breakdown.push('Symmetry constraints not fully satisfied')
  if (featureCount < 0.6)
    breakdown.push('Some requested features may be missing')
  if (parameterRange < 0.6)
    breakdown.push('Parameters outside valid ranges')
  if (hasMetrics && geometryMetrics.volume <= 0)
    breakdown.push('Warning: Zero volume detected — shape may be degenerate')

  return {
    overall,
    proportion: round(proportion),
    symmetry: round(symmetry),
    featureCount: round(featureCount),
    parameterRange: round(parameterRange),
    breakdown,
  }
}

// ─── BREP Geometry-Aware Scoring ──────────────────────────────────────

function scoreProportionFromGeometry(metrics: any, tree: DesignTree, prompt: string): number {
  const dims = metrics.dimensions || [0, 0, 0]
  const sorted = [...dims].filter(d => d > 0.001).sort((a, b) => b - a)

  if (sorted.length < 2) return 0.6

  const ratio = sorted[0] / sorted[1]

  // Engineering-grounded: most manufactured parts have aspect ratios 0.05 to 20
  // Optimal range depends on design type
  const lower = prompt.toLowerCase()
  let idealMin = 0.1
  let idealMax = 6.0

  // Gears/discs are very flat
  if (/gear|disc|plate|washer|flange/.test(lower)) { idealMin = 0.05; idealMax = 1.5 }
  // Vases/bottles are tall
  if (/vase|bottle|column|tower/.test(lower)) { idealMin = 1.5; idealMax = 8.0 }
  // Brackets are moderate
  if (/bracket|mount|frame/.test(lower)) { idealMin = 0.3; idealMax = 4.0 }

  if (ratio >= idealMin && ratio <= idealMax) return 1.0

  // Gaussian falloff outside ideal range
  if (ratio < idealMin) return Math.max(0.3, Math.exp(-2 * Math.pow(Math.log(idealMin / ratio), 2)))
  return Math.max(0.3, Math.exp(-2 * Math.pow(Math.log(ratio / idealMax), 2)))
}

function scoreSymmetryFromGeometry(metrics: any, prompt: string): number {
  const symmetryWords = ['symmetric', 'symmetrical', 'centered', 'balanced', 'even', 'uniform', 'round', 'circular', 'cylindrical', 'gear', 'vase']
  const wantsSymmetry = symmetryWords.some(w => prompt.toLowerCase().includes(w))

  // symmetry_hint from BREP: how close center-of-mass is to bounding box center
  // 1.0 = perfectly centered (high symmetry), 0.0 = very off-center
  const hint = metrics.symmetry_hint ?? 0.5

  // Face type distribution indicates symmetry
  const faceTypes = metrics.face_types || {}
  const hasCylinders = (faceTypes['CYLINDER'] || 0) > 0
  const hasSpheres = (faceTypes['SPHERE'] || 0) > 0
  const hasCones = (faceTypes['CONE'] || 0) > 0
  const hasTorus = (faceTypes['TORUS'] || 0) > 0
  const hasRadialGeometry = hasCylinders || hasSpheres || hasCones || hasTorus

  // Compactness also indicates symmetry (sphere = 1.0)
  const compactness = metrics.compactness || 0

  let score = 0.5

  if (hasRadialGeometry) score += 0.2
  if (hint > 0.9) score += 0.15
  else if (hint > 0.7) score += 0.1
  if (compactness > 0.5) score += 0.1

  if (wantsSymmetry) {
    // Bonus for meeting symmetry goal
    if (hasRadialGeometry && hint > 0.7) score += 0.15
    // Penalty for not meeting it
    if (!hasRadialGeometry && hint < 0.5) score = Math.min(score, 0.4)
  }

  return Math.min(1.0, score)
}

function scoreFeaturesFromGeometry(metrics: any, tree: DesignTree, prompt: string): number {
  const faceCount = metrics.face_count || 0
  const edgeCount = metrics.edge_count || 0
  const faceTypes = metrics.face_types || {}
  const edgeTypes = metrics.edge_types || {}

  const lower = prompt.toLowerCase()
  const complexityWords = ['with', 'and', 'plus', 'featuring', 'including', 'slots', 'holes', 'ribs', 'teeth', 'cutout', 'bore', 'fillet', 'chamfer', 'pattern']
  const complexityHits = complexityWords.filter(w => lower.includes(w)).length

  let score = 0.5

  // More faces = more features (logarithmic scaling)
  // A simple box has 6 faces. A gear might have 60+. A complex bracket 20+.
  const faceScore = Math.min(1.0, Math.log2(Math.max(faceCount, 1)) / 6)
  score = 0.3 + faceScore * 0.4

  // Bonus for variety of face types (PLANE + CYLINDER + CONE = more complex than just PLANE)
  const typeVariety = Object.keys(faceTypes).length
  if (typeVariety >= 3) score += 0.15
  else if (typeVariety >= 2) score += 0.08

  // Bonus for curved edges (CIRCLE, BSPLINE = fillets, holes, rounds)
  const curvedEdges = (edgeTypes['CIRCLE'] || 0) + (edgeTypes['BSPLINE'] || 0) + (edgeTypes['ELLIPSE'] || 0)
  if (curvedEdges > 0) score += 0.1

  // Check if complexity matches prompt
  if (complexityHits >= 3 && faceCount < 10) score = Math.min(score, 0.5) // complex prompt, simple geometry
  if (complexityHits <= 1 && faceCount > 50) score = Math.max(score, 0.8) // simple prompt, rich geometry

  // Specific feature detection from face types
  if (lower.includes('hole') || lower.includes('bore')) {
    if (faceTypes['CYLINDER'] && faceTypes['CYLINDER'] >= 2) score += 0.05
    else score -= 0.1
  }

  return Math.min(1.0, Math.max(0.1, score))
}

// ─── Fallback Tree-Only Scoring (when no BREP metrics available) ──────

function scoreProportionFromTree(tree: DesignTree): number {
  const params = tree.parameters
  const keys = Object.keys(params)
  const heightKey = keys.find(k => /height|thickness|tall|depth|z_axis/i.test(k))
  const widthKey = keys.find(k => /width|diameter|radius|size|length|outer|pitch/i.test(k))
  if (!heightKey || !widthKey) return 0.75
  const h = params[heightKey].value
  const w = params[widthKey].value
  if (w === 0 || h === 0) return 0.6
  const ratio = h / w
  if (ratio >= 0.1 && ratio <= 6.0) return 1.0
  if (ratio < 0.1) return round(0.5 + (ratio / 0.1) * 0.5)
  return round(0.5 + (6.0 / ratio) * 0.5)
}

function scoreSymmetryFromTree(tree: DesignTree, prompt: string): number {
  const symmetryWords = ['symmetric', 'symmetrical', 'centered', 'balanced', 'even', 'uniform', 'round', 'circular', 'cylindrical', 'gear', 'vase']
  const wantsSymmetry = symmetryWords.some(w => prompt.toLowerCase().includes(w))
  const nodeOps = Object.values(tree.nodes).map(n => n.op)
  const hasRadialPrimitive = nodeOps.some(op => ['cylinder', 'sphere', 'torus', 'cone'].includes(op))
  if (wantsSymmetry && hasRadialPrimitive) return 1.0
  if (!wantsSymmetry && hasRadialPrimitive) return 0.85
  if (wantsSymmetry && !hasRadialPrimitive) return 0.4
  return 0.7
}

function scoreFeaturesFromTree(tree: DesignTree, prompt: string): number {
  const nodeCount = Object.keys(tree.nodes).length
  const complexityWords = ['with', 'and', 'plus', 'featuring', 'including', 'slots', 'holes', 'ribs', 'teeth', 'cutout', 'bore']
  const complexityHits = complexityWords.filter(w => prompt.toLowerCase().includes(w)).length
  const isComplex = prompt.trim().split(/\s+/).length > 8 || complexityHits >= 2
  if (!isComplex) {
    if (nodeCount >= 2 && nodeCount <= 6) return 1.0
    if (nodeCount === 1) return 0.5
    if (nodeCount > 6) return 0.8
    return 0.5
  } else {
    if (nodeCount >= 4 && nodeCount <= 12) return 1.0
    if (nodeCount < 4) return round(0.4 + (nodeCount / 4) * 0.3)
    return 0.7
  }
}

function scoreParameterRange(tree: DesignTree): number {
  const params = Object.values(tree.parameters)
  if (params.length === 0) return 0.75
  let inRange = 0
  let total = 0
  for (const p of params) {
    total++
    if (p.min === undefined || p.max === undefined) { inRange++; continue }
    if (p.value >= p.min && p.value <= p.max) inRange++
  }
  const paramRichness = Math.min(params.length / 5, 1.0)
  const rangeScore = total > 0 ? inRange / total : 0.75
  return round(rangeScore * 0.7 + paramRichness * 0.3)
}

// ─── Helpers ──────────────────────────────────────────────────────
function round(n: number): number { return Math.round(n * 100) / 100 }

// ─── Display Utilities ────────────────────────────────────────────
export function getScoreColor(score: number): string {
  if (score >= 0.85) return 'text-green-400'
  if (score >= 0.65) return 'text-yellow-400'
  return 'text-red-400'
}

export function getScoreLabel(score: number): string {
  if (score >= 0.85) return 'Excellent'
  if (score >= 0.70) return 'Good'
  if (score >= 0.50) return 'Fair'
  return 'Poor'
}

export function getScoreBgColor(score: number): string {
  if (score >= 0.85) return 'bg-green-400/10 border-green-400/30'
  if (score >= 0.65) return 'bg-yellow-400/10 border-yellow-400/30'
  return 'bg-red-400/10 border-red-400/30'
}
