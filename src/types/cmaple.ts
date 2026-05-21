export type AlignmentFormat = 'auto' | 'fasta' | 'phylip' | 'maple'

export type AlignmentStats = {
  fileName: string
  fileSize: number
  format: AlignmentFormat
  sequenceCount: number
  sequenceLength: number
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
      type: 'infer'
      id: string
      numThreads: number
      computeBranchSupport: boolean
      branchSupportReplicates: number
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
      type: 'error'
      id?: string
      error: string
    }
