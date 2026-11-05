import type { ConstantSiteCounts, InferenceOptions, WarningSummaryOptions } from './types.js'

export const DEFAULT_MAX_DIVERGENCE_PERCENT = 6.7
export const ZERO_CONSTANT_SITES: ConstantSiteCounts = Object.freeze({ a: 0, c: 0, g: 0, t: 0 })

export type ResolvedInferenceOptions = {
  numThreads: number
  substitutionModel: NonNullable<InferenceOptions['substitutionModel']>
  branchSupportMethod: NonNullable<InferenceOptions['branchSupportMethod']>
  branchSupportReplicates: number
  branchSupportEpsilon: number
  filterDivergentSamples: boolean
  maxDivergencePercent: number
  constantSites: ConstantSiteCounts
  startingTree: string
  startingAlignment: string
  branchLengthsFixed: boolean
  noReroot: boolean
  treeSearchType: NonNullable<InferenceOptions['treeSearchType']>
  estimateMat: boolean
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function defaultThreadCount(): number {
  const cpus = typeof navigator === 'undefined' ? 1 : navigator.hardwareConcurrency || 1
  return Math.max(1, Math.floor(cpus / 2))
}

export function sanitizeConstantSites(counts: ConstantSiteCounts | undefined): ConstantSiteCounts {
  if (!counts) return { ...ZERO_CONSTANT_SITES }
  return {
    a: nonNegativeInteger(counts.a),
    c: nonNegativeInteger(counts.c),
    g: nonNegativeInteger(counts.g),
    t: nonNegativeInteger(counts.t),
  }
}

export function resolveInferenceOptions(options: InferenceOptions = {}): ResolvedInferenceOptions {
  return {
    numThreads: positiveInteger(options.numThreads, defaultThreadCount()),
    substitutionModel: options.substitutionModel ?? 'GTR',
    branchSupportMethod: options.branchSupportMethod ?? 'sprta',
    branchSupportReplicates: positiveInteger(options.branchSupportReplicates, 1000),
    branchSupportEpsilon: nonNegativeNumber(options.branchSupportEpsilon, 0.1),
    filterDivergentSamples: options.filterDivergentSamples ?? false,
    maxDivergencePercent: nonNegativeNumber(options.maxDivergencePercent, DEFAULT_MAX_DIVERGENCE_PERCENT),
    constantSites: sanitizeConstantSites(options.constantSites),
    startingTree: options.startingTree ?? '',
    startingAlignment: options.startingAlignment ?? '',
    branchLengthsFixed: options.branchLengthsFixed ?? false,
    noReroot: options.noReroot ?? false,
    treeSearchType: options.treeSearchType ?? 'normal',
    estimateMat: options.estimateMat ?? false,
  }
}

export type ResolvedWarningSummaryOptions = {
  filterDivergentSamples: boolean
  maxDivergencePercent: number
  constantSites: ConstantSiteCounts
}

export function resolveWarningSummaryOptions(
  options: WarningSummaryOptions = {},
): ResolvedWarningSummaryOptions {
  return {
    filterDivergentSamples: options.filterDivergentSamples ?? false,
    maxDivergencePercent: nonNegativeNumber(options.maxDivergencePercent, DEFAULT_MAX_DIVERGENCE_PERCENT),
    constantSites: sanitizeConstantSites(options.constantSites),
  }
}
