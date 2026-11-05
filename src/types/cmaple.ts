import type {
  AlignmentFormat,
  AlignmentStats,
  AlignmentWarningSummary,
  BranchSupportMethod,
  ConstantSiteCounts,
  DivergenceSummary,
  SequenceType,
  SubstitutionModel,
  TreeSearchType,
} from '@wytamma/maple-wasm'

export type {
  AlignmentFormat,
  AlignmentStats,
  AlignmentWarningSummary,
  BranchSupportMethod,
  ConstantSiteCounts,
  DivergenceSummary,
  SequenceType,
  SubstitutionModel,
  TreeSearchType,
} from '@wytamma/maple-wasm'

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
      startingTreeText: string
      startingAlignmentText: string
      branchLengthsFixed: boolean
      noReroot: boolean
      treeSearchType: TreeSearchType
      estimateMat: boolean
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
      nexus?: string
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
