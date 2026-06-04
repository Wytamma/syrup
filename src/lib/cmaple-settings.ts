import type { AlignmentStats, AlignmentWarningSummary, ConstantSiteCounts, DivergenceSummary } from '../types/cmaple'

export const DEFAULT_MAX_DIVERGENCE_PERCENT = 6.7
export const ZERO_CONSTANT_SITES: ConstantSiteCounts = { a: 0, c: 0, g: 0, t: 0 }

const CMAPLE_MAX_SUBS_PER_SITE = 0.067
const CMAPLE_MEAN_SUBS_PER_SITE = 0.02
const LARGE_ALIGNMENT_SITE_COUNT = 50_000_000
const LONG_RUN_RECOMMENDATION =
  'Consider turning off SH-aLRT support or lowering the number of replicates for a faster less robust analysis.'

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function countIncludedSamples(scores: number[], isFilterEnabled: boolean, threshold: number) {
  if (!isFilterEnabled) return scores.length
  let low = 0
  let high = scores.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (scores[middle] <= threshold) low = middle + 1
    else high = middle
  }

  return low
}

export function getIncludedSampleCount(
  currentDivergence: DivergenceSummary | null,
  isFilterEnabled: boolean,
  threshold: number,
) {
  const scores = currentDivergence?.sampleScores ?? []
  return countIncludedSamples(scores, isFilterEnabled, threshold)
}

export function getTotalConstantSites(counts: ConstantSiteCounts) {
  return counts.a + counts.c + counts.g + counts.t
}

export function sanitizeConstantSites(counts: ConstantSiteCounts): ConstantSiteCounts {
  return {
    a: Math.max(0, Math.floor(Number(counts.a) || 0)),
    c: Math.max(0, Math.floor(Number(counts.c) || 0)),
    g: Math.max(0, Math.floor(Number(counts.g) || 0)),
    t: Math.max(0, Math.floor(Number(counts.t) || 0)),
  }
}

export function formatConstantSites(counts: ConstantSiteCounts) {
  return [counts.a, counts.c, counts.g, counts.t].join(', ')
}

export function parseConstantSites(value: string): ConstantSiteCounts | null {
  const parts = value
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)

  if (parts.length !== 4) return null

  const counts = parts.map((part) => Number(part.replaceAll('_', '')))
  if (counts.some((count) => !Number.isFinite(count) || count < 0)) return null

  return sanitizeConstantSites({
    a: counts[0],
    c: counts[1],
    g: counts[2],
    t: counts[3],
  })
}

export function constantSitesEqual(left: ConstantSiteCounts | undefined, right: ConstantSiteCounts) {
  return !!left && left.a === right.a && left.c === right.c && left.g === right.g && left.t === right.t
}

export function getAdjustedSequenceLength(currentStats: AlignmentStats | null, counts: ConstantSiteCounts) {
  return (currentStats?.sequenceLength ?? 0) + getTotalConstantSites(counts)
}

export function getAdjustedDivergence(
  currentDivergence: DivergenceSummary | null,
  currentStats: AlignmentStats | null,
  counts: ConstantSiteCounts,
): DivergenceSummary | null {
  if (!currentDivergence || !currentStats) return currentDivergence
  const adjustedLength = getAdjustedSequenceLength(currentStats, counts)
  if (adjustedLength <= 0 || adjustedLength === currentStats.sequenceLength) return currentDivergence

  const scale = currentStats.sequenceLength / adjustedLength
  return {
    ...currentDivergence,
    sampleScores: currentDivergence.sampleScores.map((score) => score * scale),
    maxScore: currentDivergence.maxScore * scale,
  }
}

export function getEffectiveStatus(
  currentStats: AlignmentStats | null,
  currentDivergence: DivergenceSummary | null,
  isFilterEnabled: boolean,
  threshold: number,
  currentConstantSites: ConstantSiteCounts,
  fallbackEffective: boolean | null,
) {
  if (!currentStats || !currentDivergence) return fallbackEffective

  const includedCount = getIncludedSampleCount(currentDivergence, isFilterEnabled, threshold)
  if (includedCount < 3) return false

  const adjustedLength = getAdjustedSequenceLength(currentStats, currentConstantSites)
  const maxMutations = adjustedLength * CMAPLE_MAX_SUBS_PER_SITE
  let remainingMutationBudget = adjustedLength * CMAPLE_MEAN_SUBS_PER_SITE * includedCount

  for (let index = 0; index < includedCount; index += 1) {
    const mutationCount = currentDivergence.cmapleMutationCounts[index] ?? 0
    if (mutationCount > maxMutations) return false
    remainingMutationBudget -= mutationCount
    if (remainingMutationBudget < 0) return false
  }

  return true
}

export function getDisplayedWarnings(
  currentStats: AlignmentStats | null,
  isFilterEnabled: boolean,
  currentDivergence: DivergenceSummary | null,
  currentWarningSummary: AlignmentWarningSummary | null,
  currentWarnings: string[],
  currentThreshold: number,
  currentConstantSites: ConstantSiteCounts,
) {
  if (!currentStats || !currentDivergence) return currentWarnings
  const localWarnings = getConstantSiteWarnings(currentConstantSites)

  if (!isFilterEnabled && getTotalConstantSites(currentConstantSites) > 0) {
    return [...currentWarnings, ...localWarnings]
  }

  if (!isFilterEnabled) return currentWarnings

  if (
    !currentWarningSummary ||
    currentWarningSummary.filterDivergentSamples !== isFilterEnabled ||
    Math.abs(currentWarningSummary.maxDivergencePercent - currentThreshold) > 0.01 ||
    !constantSitesEqual(currentWarningSummary.constantSites, currentConstantSites)
  ) {
    return [...currentWarnings, ...localWarnings]
  }

  return [...getWarningsForSummary(currentWarningSummary, currentStats), ...localWarnings]
}

function getConstantSiteWarnings(counts: ConstantSiteCounts) {
  return getTotalConstantSites(counts) > 0
    ? [
        'With constant-site counts, inference uses an adjusted alignment length for likelihood, branch lengths, and SH-aLRT support. SH-aLRT may take longer when many constant sites are supplied.',
      ]
    : []
}

export function isCurrentWarningSummary(
  currentWarningSummary: AlignmentWarningSummary | null,
  isFilterEnabled: boolean,
  currentThreshold: number,
  currentConstantSites: ConstantSiteCounts,
) {
  return (
    !!currentWarningSummary &&
    currentWarningSummary.filterDivergentSamples === isFilterEnabled &&
    Math.abs(currentWarningSummary.maxDivergencePercent - currentThreshold) <= 0.01 &&
    constantSitesEqual(currentWarningSummary.constantSites, currentConstantSites)
  )
}

function getWarningsForSummary(summary: AlignmentWarningSummary, originalStats: AlignmentStats) {
  const isLargeObservedAlignment = summary.sequenceCount * originalStats.sequenceLength >= LARGE_ALIGNMENT_SITE_COUNT
  const variableColumnsPerKb = originalStats.sequenceLength ? summary.variableColumns / (originalStats.sequenceLength / 1000) : 0
  const hasDenseVariation = summary.variableColumns >= 2000 && variableColumnsPerKb >= 50
  const hasSubstantialAmbiguity = summary.meanAmbiguousSites >= 100 && summary.ambiguousFraction >= 0.01
  const hasDifficultVariation = hasDenseVariation && hasSubstantialAmbiguity

  if (!isLargeObservedAlignment && !hasDifficultVariation) return []

  const details = [
    hasDifficultVariation ? `${summary.variableColumns.toLocaleString()} variable columns` : '',
    hasDifficultVariation
      ? `${Math.round(summary.meanAmbiguousSites).toLocaleString()} ambiguous sites per sequence on average`
      : '',
  ].filter(Boolean)
  return [
    [
      isLargeObservedAlignment
        ? 'This is a large alignment and may take several minutes in the browser, especially with SH-aLRT support enabled.'
        : 'This alignment may take several minutes in the browser, especially with SH-aLRT support enabled.',
      details.length ? ` It has ${details.join(' and ')}.` : '',
      ' ',
      LONG_RUN_RECOMMENDATION,
    ].join(''),
  ]
}

function hasDifficultVariation(summary: AlignmentWarningSummary | null) {
  if (!summary) return false
  const variableColumnsPerKb = summary.sequenceLength ? summary.variableColumns / (summary.sequenceLength / 1000) : 0
  const hasDenseVariation = summary.variableColumns >= 2000 && variableColumnsPerKb >= 50
  const hasSubstantialAmbiguity = summary.meanAmbiguousSites >= 100 && summary.ambiguousFraction >= 0.01
  return hasDenseVariation && hasSubstantialAmbiguity
}

export function getDefaultThreadCount(
  currentWarningSummary: AlignmentWarningSummary | null,
  availableThreads: number,
) {
  if (availableThreads <= 1) return 1
  if (hasDifficultVariation(currentWarningSummary)) return 1
  return Math.max(1, Math.min(4, availableThreads))
}
