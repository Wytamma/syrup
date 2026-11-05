export type AlignmentFormat = 'auto' | 'fasta' | 'phylip' | 'maple'

export type BranchSupportMethod = 'none' | 'sprta' | 'sh-alrt'

export type SequenceType = 'dna' | 'protein'

export type SubstitutionModel =
  | 'GTR'
  | 'JC'
  | 'UNREST'
  | 'GTR20'
  | 'NONREV'
  | 'LG'
  | 'WAG'
  | 'JTT'
  | 'Q.PFAM'
  | 'Q.BIRD'
  | 'Q.MAMMAL'
  | 'Q.INSECT'
  | 'Q.PLANT'
  | 'Q.YEAST'
  | 'JTTDCMUT'
  | 'DCMUT'
  | 'VT'
  | 'PMB'
  | 'BLOSUM62'
  | 'DAYHOFF'
  | 'MTREV'
  | 'MTART'
  | 'MTZOA'
  | 'MTMET'
  | 'MTVER'
  | 'MTINV'
  | 'MTMAM'
  | 'FLAVI'
  | 'HIVB'
  | 'HIVW'
  | 'FLU'
  | 'RTREV'
  | 'CPREV'
  | 'NQ.PFAM'
  | 'NQ.BIRD'
  | 'NQ.MAMMAL'
  | 'NQ.INSECT'
  | 'NQ.PLANT'
  | 'NQ.YEAST'

export type TreeSearchType = 'fast' | 'normal' | 'exhaustive'

export type AlignmentStats = {
  fileName: string
  fileSize: number
  format: AlignmentFormat
  sequenceType: SequenceType
  sampleNames: string[]
  sequenceCount: number
  sequenceLength: number
}

export type DivergenceSummary = {
  sampleScores: number[]
  cmapleMutationCounts: number[]
  maxScore: number
}

export type ConstantSiteCounts = {
  a: number
  c: number
  g: number
  t: number
}

export type AlignmentWarningSummary = {
  filterDivergentSamples: boolean
  maxDivergencePercent: number
  constantSites: ConstantSiteCounts
  sequenceCount: number
  removedCount: number
  sequenceLength: number
  variableColumns: number
  meanAmbiguousSites: number
  ambiguousFraction: number
}

/** Result of parsing an alignment. The parsed alignment is retained in WASM memory until released. */
export type Preflight = {
  stats: AlignmentStats
  effective: boolean
  warnings: string[]
  divergence: DivergenceSummary
  warningSummary: AlignmentWarningSummary
}

export type InferenceResult = {
  newick: string
  nexus: string
  logLikelihood: number
  effective: boolean
  warnings: string[]
}

export type ParseOptions = {
  /** Alignment format. Defaults to `auto` detection. */
  format?: AlignmentFormat
  /** Name reported back in `stats.fileName`. */
  fileName?: string
}

export type WarningSummaryOptions = {
  filterDivergentSamples?: boolean
  maxDivergencePercent?: number
  constantSites?: ConstantSiteCounts
}

export type InferenceOptions = {
  /** Number of CMAPLE worker threads. Defaults to half the available hardware concurrency. */
  numThreads?: number
  /** Defaults to `GTR`. Protein alignments must pass a protein model explicitly. */
  substitutionModel?: SubstitutionModel
  /** Defaults to `sprta`. */
  branchSupportMethod?: BranchSupportMethod
  /** Defaults to `1000`. */
  branchSupportReplicates?: number
  /** Defaults to `0.1`. */
  branchSupportEpsilon?: number
  /** Defaults to `false`. */
  filterDivergentSamples?: boolean
  /** Defaults to `6.7`. */
  maxDivergencePercent?: number
  /** Defaults to all zeroes. */
  constantSites?: ConstantSiteCounts
  /** Newick starting tree. */
  startingTree?: string
  /** MAPLE starting alignment. */
  startingAlignment?: string
  /** Defaults to `false`. */
  branchLengthsFixed?: boolean
  /** Defaults to `false`. */
  noReroot?: boolean
  /** Defaults to `normal`. */
  treeSearchType?: TreeSearchType
  /** Defaults to `false`. */
  estimateMat?: boolean
}

export type RuntimeOptions = {
  /** URL of `cmaple-threaded.wasm`. Defaults to the copy shipped with this package. */
  wasmUrl?: string | URL
  /** URL of `cmaple-threaded.js`. Defaults to the copy shipped with this package. */
  scriptUrl?: string | URL
  /** Receives CMAPLE stdout. */
  onStdout?: (message: string) => void
  /** Receives CMAPLE stderr. */
  onStderr?: (message: string) => void
  /**
   * Refuse to start when `crossOriginIsolated` is false. Threaded WASM needs
   * SharedArrayBuffer, which browsers only expose in cross-origin isolated
   * documents. Defaults to `true`.
   */
  requireCrossOriginIsolation?: boolean
}
