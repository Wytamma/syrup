export type AlignmentFormat = 'auto' | 'fasta' | 'phylip' | 'maple'
export type BranchSupportMethod = 'none' | 'sprta' | 'sh-alrt'
export type SubstitutionModel = 'GTR' | 'JC' | 'UNREST'
export type TreeSearchType = 'fast' | 'normal' | 'exhaustive'

export type AlignmentStats = {
  fileName: string
  fileSize: number
  format: AlignmentFormat
  sequenceCount: number
  sequenceLength: number
}

export type DivergenceSummary = {
  sampleScores: number[]
  cmapleMutationCounts: number[]
  maxScore: number
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

export type ConstantSiteCounts = {
  a: number
  c: number
  g: number
  t: number
}

export type CmapleWorkerRequest =
  | {
      type: 'load'
      id: string
      fileName: string
      format: AlignmentFormat
      data: Uint8Array
    }
  | {
      type: 'summarize-filter'
      id: string
      filterDivergentSamples: boolean
      maxDivergencePercent: number
      constantSites: ConstantSiteCounts
    }
  | {
      type: 'infer'
      id: string
      numThreads: number
      substitutionModel: SubstitutionModel
      branchSupportMethod: BranchSupportMethod
      branchSupportReplicates: number
      branchSupportEpsilon: number
      filterDivergentSamples: boolean
      maxDivergencePercent: number
      constantSites: ConstantSiteCounts
      referenceTreeText: string
      branchLengthsFixed: boolean
      treeSearchType: TreeSearchType
    }
  | {
      type: 'export-maple'
      id: string
    }
  | {
      type: 'clear'
      id: string
    }

export type CmapleWorkerResponse =
  | {
      type: 'log'
      id?: string
      message: string
      stream: 'stdout' | 'stderr'
    }
  | {
      type: 'preflight'
      id: string
      stats: AlignmentStats
      effective: boolean
      warnings: string[]
      divergence: DivergenceSummary
      warningSummary: AlignmentWarningSummary
    }
  | {
      type: 'warning-summary'
      id: string
      warningSummary: AlignmentWarningSummary
    }
  | {
      type: 'result'
      id: string
      newick: string
      logLikelihood: number
      effective: boolean
      warnings: string[]
    }
  | {
      type: 'maple-export'
      id: string
      maple: string
    }
  | {
      type: 'error'
      id?: string
      error: string
    }
