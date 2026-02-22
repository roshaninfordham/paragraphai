import type { DesignTree, ScoreResult } from '@/lib/types'

// ─── Main Scoring Function ────────────────────────────────────────
export function scoreDesign(
  tree: DesignTree,
  prompt: string
): ScoreResult {
  const proportion = scoreProportions(tree)
  const symmetry = scoreSymmetry(tree, prompt)
  const featureCount = scoreFeatureCount(tree, prompt)
  const parameterRange = scoreParameterRange(tree)

  const overall = round(
    proportion * 0.25 +
    symmetry * 0.2 +
    featureCount * 0.3 +
    parameterRange * 0.25
  )

  const breakdown: string[] = []
  if (proportion < 0.6)
    breakdown.push('Proportions may need adjustment — check dimension ratios')
  if (symmetry < 0.6)
    breakdown.push('Symmetry constraints not satisfied')
  if (featureCount < 0.6)
    breakdown.push('Feature count does not match design complexity')
  if (parameterRange < 0.6)
    breakdown.push('Some parameters are outside valid range')

  return {
    overall,
    proportion: round(proportion),
    symmetry: round(symmetry),
    featureCount: round(featureCount),
    parameterRange: round(parameterRange),
    breakdown,
  }
}

// ─── Sub-scores ───────────────────────────────────────────────────

function scoreProportions(tree: DesignTree): number {
  const params = tree.parameters
  const keys = Object.keys(params)

  // Broader matching for Build123d parameter naming conventions
  const heightKey = keys.find((k) =>
    /height|thickness|tall|depth|z_axis/i.test(k)
  )
  const widthKey = keys.find((k) =>
    /width|diameter|radius|size|length|outer|pitch/i.test(k)
  )

  // If we can't identify two dimension axes, assume proportions are reasonable
  if (!heightKey || !widthKey) return 0.75

  const h = params[heightKey].value
  const w = params[widthKey].value
  if (w === 0 || h === 0) return 0.6

  const ratio = h / w
  // Wider acceptable range — gears are flat (0.1), vases are tall (5+)
  if (ratio >= 0.1 && ratio <= 6.0) return 1.0
  if (ratio < 0.1) return round(0.5 + (ratio / 0.1) * 0.5)
  return round(0.5 + (6.0 / ratio) * 0.5)
}

function scoreSymmetry(tree: DesignTree, prompt: string): number {
  const symmetryWords = [
    'symmetric', 'symmetrical', 'centered',
    'balanced', 'even', 'uniform', 'round',
    'circular', 'cylindrical', 'gear', 'vase',
  ]
  const wantsSymmetry = symmetryWords.some((w) =>
    prompt.toLowerCase().includes(w)
  )

  const paramKeys = Object.keys(tree.parameters)
  const nodeOps = Object.values(tree.nodes).map(n => n.op)

  // Detect symmetry patterns in Build123d trees
  const hasSymmetryPattern =
    paramKeys.some((k) => /count|array|pattern|repeat|teeth|ribs/i.test(k)) ||
    nodeOps.some(op => /cylinder|sphere|torus|pattern_polar|pattern_linear/i.test(op))

  // Cylindrical/spherical primitives are inherently symmetric
  const hasRadialPrimitive = nodeOps.some(op =>
    ['cylinder', 'sphere', 'torus', 'cone'].includes(op)
  )

  const hasSymmetry = hasSymmetryPattern || hasRadialPrimitive

  if (wantsSymmetry && hasSymmetry) return 1.0
  if (!wantsSymmetry && hasSymmetry) return 0.85
  if (wantsSymmetry && !hasSymmetry) return 0.4
  return 0.7
}

function scoreFeatureCount(
  tree: DesignTree,
  prompt: string
): number {
  const nodeCount = Object.keys(tree.nodes).length
  const paramCount = Object.keys(tree.parameters).length
  const wordCount = prompt.trim().split(/\s+/).length

  const complexityWords = ['with', 'and', 'plus', 'featuring', 'including', 'slots', 'holes', 'ribs', 'teeth', 'cutout', 'bore']
  const complexityHits = complexityWords.filter((w) => prompt.toLowerCase().includes(w)).length
  const isComplex = wordCount > 8 || complexityHits >= 2

  if (!isComplex) {
    // Simple prompts: 2-6 nodes is ideal
    if (nodeCount >= 2 && nodeCount <= 6) return 1.0
    if (nodeCount === 1) return 0.5
    if (nodeCount > 6) return 0.8
    return 0.5
  } else {
    // Complex prompts: 4-12 nodes is ideal (gears, enclosures)
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
    if (p.min === undefined || p.max === undefined) {
      inRange++ // No bounds defined = assume valid
      continue
    }
    if (p.value >= p.min && p.value <= p.max) {
      inRange++
    }
  }

  // Bonus for having more parameters (richer parametric model)
  const paramRichness = Math.min(params.length / 5, 1.0)
  const rangeScore = total > 0 ? inRange / total : 0.75

  return round(rangeScore * 0.7 + paramRichness * 0.3)
}

// ─── Helpers ──────────────────────────────────────────────────────
function round(n: number): number {
  return Math.round(n * 100) / 100
}

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
