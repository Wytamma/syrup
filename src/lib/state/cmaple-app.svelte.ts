import {
  DEFAULT_MAX_DIVERGENCE_PERCENT,
  ZERO_CONSTANT_SITES,
  constantSitesEqual,
  formatConstantSites,
  getAdjustedDivergence,
  getAdjustedSequenceLength,
  getDefaultThreadCount,
  getDisplayedWarnings,
  getEffectiveStatus,
  getTotalConstantSites,
  isCurrentWarningSummary,
  parseConstantSites,
  sanitizeConstantSites,
} from '../cmaple-settings'
import type { AlignmentStats, AlignmentWarningSummary, CmapleWorkerResponse, ConstantSiteCounts, DivergenceSummary } from '../../types/cmaple'

export type AppState = 'idle' | 'preflight' | 'ready' | 'running' | 'done' | 'error'

const ALIGNMENT_QUERY_PARAM = 'alignment'

class CmapleApp {
  worker: Worker | null = null
  state: AppState = $state('idle')
  currentId = $state('')
  selectedFile: File | null = $state(null)
  fileName = $state('')
  error = $state('')
  stats: AlignmentStats | null = $state(null)
  divergence: DivergenceSummary | null = $state(null)
  warningSummary: AlignmentWarningSummary | null = $state(null)
  effective: boolean | null = $state(null)
  warnings: string[] = $state([])
  displayedWarnings: string[] = $state([])
  warningSummaryPending = $state(false)
  logs: string[] = $state([])
  newick = $state('')
  logLikelihood: number | null = $state(null)
  showInternalLabels = $state(false)
  showLeafLabels = $state(true)
  elapsedMs = $state(0)
  didCopyNewick = $state(false)
  didDownloadNewick = $state(false)
  numThreads = $state(Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)))
  maxThreads = Math.max(1, navigator.hardwareConcurrency || 1)
  computeBranchSupport = $state(true)
  branchSupportReplicates = $state(1000)
  filterDivergentSamples = $state(false)
  maxDivergencePercent = $state(DEFAULT_MAX_DIVERGENCE_PERCENT)
  useConstantSites = $state(false)
  constantSites: ConstantSiteCounts = $state({ a: 0, c: 0, g: 0, t: 0 })
  constantSitesText = $state(formatConstantSites(this.constantSites))
  didAutoDisableBranchSupportForConstantSites = $state(false)

  activeConstantSites: ConstantSiteCounts = $derived(this.useConstantSites ? this.constantSites : ZERO_CONSTANT_SITES)
  adjustedSequenceLength = $derived(getAdjustedSequenceLength(this.stats, this.activeConstantSites))
  adjustedDivergence = $derived(getAdjustedDivergence(this.divergence, this.stats, this.activeConstantSites))
  effectiveStatus = $derived(
    getEffectiveStatus(
      this.stats,
      this.adjustedDivergence,
      this.filterDivergentSamples,
      this.maxDivergencePercent,
      this.activeConstantSites,
      this.effective,
    ),
  )
  nextDisplayedWarnings = $derived(
    getDisplayedWarnings(
      this.stats,
      this.filterDivergentSamples,
      this.divergence,
      this.warningSummary,
      this.warnings,
      this.maxDivergencePercent,
      this.activeConstantSites,
    ),
  )

  private timerId: number | null = null
  private copyFeedbackTimer: number | null = null
  private downloadFeedbackTimer: number | null = null

  constructor() {
    $effect(() => {
      if (
        !this.warningSummaryPending ||
        isCurrentWarningSummary(this.warningSummary, this.filterDivergentSamples, this.maxDivergencePercent, this.activeConstantSites)
      ) {
        this.displayedWarnings = this.nextDisplayedWarnings
      }
    })
  }

  destroy = () => {
    this.clearFeedbackTimer('copy')
    this.clearFeedbackTimer('download')
    if (this.currentId) this.worker?.postMessage({ type: 'clear', id: this.currentId })
    this.stopTimer()
    this.worker?.terminate()
    this.worker = null
  }

  loadAlignmentFromQueryParam = () => {
    if (typeof window === 'undefined') return
    const alignmentUrl = new URLSearchParams(window.location.search).get(ALIGNMENT_QUERY_PARAM)
    if (alignmentUrl) void this.loadAlignmentFromUrl(alignmentUrl)
  }

  requestWarningSummary = () => {
    if (!this.currentId || this.state !== 'ready') return
    this.warningSummaryPending = this.filterDivergentSamples
    this.getWorker().postMessage({
      type: 'summarize-filter',
      id: this.currentId,
      filterDivergentSamples: this.filterDivergentSamples,
      maxDivergencePercent: this.maxDivergencePercent,
      constantSites: this.getActiveConstantSites(),
    })
  }

  setFilterDivergentSamples = (value: boolean) => {
    this.filterDivergentSamples = value
    if (!value) this.warningSummaryPending = false
    this.requestWarningSummary()
  }

  setMaxDivergencePercent = (value: number) => {
    this.maxDivergencePercent = value
    this.warningSummaryPending = false
  }

  setConstantSiteCountsFromText = (value = this.constantSitesText, shouldRequestWarningSummary = true) => {
    this.constantSitesText = value
    const parsedCounts = parseConstantSites(value)
    if (!parsedCounts) return
    const hadConstantSites = getTotalConstantSites(this.constantSites) > 0
    const hasConstantSites = getTotalConstantSites(parsedCounts) > 0
    this.constantSites = parsedCounts
    if (hasConstantSites && !hadConstantSites) this.useConstantSites = true
    if (this.useConstantSites && hasConstantSites && !hadConstantSites && !this.didAutoDisableBranchSupportForConstantSites) {
      this.computeBranchSupport = false
      this.didAutoDisableBranchSupportForConstantSites = true
    }
    if (shouldRequestWarningSummary && this.filterDivergentSamples) this.requestWarningSummary()
  }

  setUseConstantSites = (value: boolean) => {
    this.setConstantSiteCountsFromText(this.constantSitesText, false)
    this.useConstantSites = value
    if (value && getTotalConstantSites(this.constantSites) > 0 && !this.didAutoDisableBranchSupportForConstantSites) {
      this.computeBranchSupport = false
      this.didAutoDisableBranchSupportForConstantSites = true
    }
    if (this.filterDivergentSamples) this.requestWarningSummary()
  }

  clearCurrent = () => {
    if (this.currentId) {
      this.worker?.postMessage({ type: 'clear', id: this.currentId })
    }
    this.currentId = ''
    this.selectedFile = null
    this.fileName = ''
    this.error = ''
    this.stats = null
    this.divergence = null
    this.warningSummary = null
    this.warningSummaryPending = false
    this.effective = null
    this.warnings = []
    this.useConstantSites = false
    this.constantSites = { a: 0, c: 0, g: 0, t: 0 }
    this.constantSitesText = formatConstantSites(this.constantSites)
    this.didAutoDisableBranchSupportForConstantSites = false
    this.logs = []
    this.newick = ''
    this.logLikelihood = null
    this.showInternalLabels = false
    this.showLeafLabels = true
    this.didCopyNewick = false
    this.didDownloadNewick = false
    this.clearFeedbackTimer('copy')
    this.clearFeedbackTimer('download')
    this.elapsedMs = 0
    this.stopTimer()
    this.state = 'idle'
  }

  loadAlignmentFromUrl = async (url: string) => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return

    const fallbackName = this.getAlignmentFileNameFromUrl(trimmedUrl)

    try {
      this.logs = [`Downloading alignment from ${trimmedUrl}`]

      const response = await fetch(trimmedUrl)
      if (!response.ok) {
        throw new Error(`Could not download alignment (${response.status} ${response.statusText}).`)
      }

      const blob = await response.blob()
      const file = new File([blob], fallbackName, {
        type: blob.type || 'text/plain',
      })

      await this.loadFile(file)
    } catch (err) {
      this.selectedFile = null
      this.fileName = fallbackName
      this.error = err instanceof Error ? err.message : 'Could not download the alignment from the provided URL.'
      this.logs = []
      this.state = 'error'
    }
  }

  loadFile = async (file: File) => {
    if (this.currentId) this.worker?.postMessage({ type: 'clear', id: this.currentId })

    this.currentId = crypto.randomUUID()
    this.selectedFile = file
    this.fileName = file.name
    this.error = ''
    this.stats = null
    this.divergence = null
    this.warningSummary = null
    this.warningSummaryPending = false
    this.effective = null
    this.warnings = []
    this.useConstantSites = false
    this.constantSites = { a: 0, c: 0, g: 0, t: 0 }
    this.constantSitesText = formatConstantSites(this.constantSites)
    this.didAutoDisableBranchSupportForConstantSites = false
    this.logs = []
    this.newick = ''
    this.logLikelihood = null
    this.state = 'preflight'
    this.startTimer()

    try {
      const data = new Uint8Array(await file.arrayBuffer())
      this.getWorker().postMessage(
        {
          type: 'load',
          id: this.currentId,
          fileName: file.name,
          format: 'auto',
          data,
        },
        [data.buffer],
      )
    } catch (err) {
      this.stopTimer()
      this.error = err instanceof Error ? err.message : 'Could not read the selected file.'
      this.state = 'error'
    }
  }

  runInference = () => {
    if (!this.currentId || this.state !== 'ready') return
    this.branchSupportReplicates = Math.max(1, Math.floor(Number(this.branchSupportReplicates) || 1000))
    this.maxDivergencePercent = Math.max(0, Number(this.maxDivergencePercent) || DEFAULT_MAX_DIVERGENCE_PERCENT)
    this.error = ''
    this.logs = []
    this.startTimer()
    this.state = 'running'
    this.getWorker().postMessage({
      type: 'infer',
      id: this.currentId,
      numThreads: this.numThreads,
      computeBranchSupport: this.computeBranchSupport,
      branchSupportReplicates: this.branchSupportReplicates,
      filterDivergentSamples: this.filterDivergentSamples,
      maxDivergencePercent: this.maxDivergencePercent,
      constantSites: sanitizeConstantSites(this.activeConstantSites),
    })
  }

  copyNewick = async () => {
    if (!this.newick) return
    await navigator.clipboard.writeText(this.newick)
    this.showActionFeedback('copy')
  }

  downloadNewick = () => {
    if (!this.newick) return
    const blob = new Blob([this.newick], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = this.fileName.replace(/\.[^.]+$/, '') || 'cmaple-tree'
    link.href = url
    link.download = `${baseName}.nwk`
    link.click()
    URL.revokeObjectURL(url)
    this.showActionFeedback('download')
  }

  toggleInternalLabels = () => {
    this.showInternalLabels = !this.showInternalLabels
  }

  toggleLeafLabels = () => {
    this.showLeafLabels = !this.showLeafLabels
  }

  returnToRunSettings = () => {
    if (!this.currentId || !this.stats) return
    this.error = ''
    this.logs = []
    this.elapsedMs = 0
    this.stopTimer()
    this.state = 'ready'
  }

  private getActiveConstantSites = () => {
    return this.useConstantSites ? this.constantSites : ZERO_CONSTANT_SITES
  }

  private getAlignmentFileNameFromUrl = (url: string) => {
    try {
      if (url.startsWith('http') || url.startsWith('ftp')) {
        const parsedUrl = new URL(url)
        const fromPath = parsedUrl.pathname.split('/').filter(Boolean).at(-1)
        return fromPath || 'alignment.fa'
      }
      const fromPath = url.split('/').filter(Boolean).at(-1)
      return fromPath || 'alignment.fa'
    } catch {
      return 'alignment.fa'
    }
  }

  private stopTimer = () => {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId)
      this.timerId = null
    }
  }

  private startTimer = () => {
    const startedAt = Date.now()
    this.elapsedMs = 0
    this.stopTimer()
    this.timerId = window.setInterval(() => {
      this.elapsedMs = Date.now() - startedAt
    }, 250)
  }

  private clearFeedbackTimer = (kind: 'copy' | 'download') => {
    const timer = kind === 'copy' ? this.copyFeedbackTimer : this.downloadFeedbackTimer
    if (timer !== null) {
      window.clearTimeout(timer)
    }

    if (kind === 'copy') this.copyFeedbackTimer = null
    else this.downloadFeedbackTimer = null
  }

  private showActionFeedback = (kind: 'copy' | 'download') => {
    this.clearFeedbackTimer(kind)

    if (kind === 'copy') {
      this.didCopyNewick = true
      this.copyFeedbackTimer = window.setTimeout(() => {
        this.didCopyNewick = false
        this.copyFeedbackTimer = null
      }, 1400)
      return
    }

    this.didDownloadNewick = true
    this.downloadFeedbackTimer = window.setTimeout(() => {
      this.didDownloadNewick = false
      this.downloadFeedbackTimer = null
    }, 1400)
  }

  private getWorker = () => {
    if (this.worker) return this.worker

    this.worker = new Worker(new URL('../../cmaple.worker.ts', import.meta.url), {
      type: 'module',
    })

    this.worker.onmessage = (event: MessageEvent<CmapleWorkerResponse>) => {
      const message = event.data
      if ('id' in message && message.id && message.id !== this.currentId) return

      if (message.type === 'log') {
        const lines = message.message
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length) this.logs = [...this.logs, ...lines].slice(-220)
        return
      }

      if (message.type === 'error') {
        this.error = message.error
        this.warningSummaryPending = false
        this.stopTimer()
        this.state = this.stats ? 'ready' : 'error'
        return
      }

      if (message.type === 'preflight') {
        this.stats = message.stats
        this.divergence = message.divergence
        this.warningSummary = message.warningSummary
        this.warningSummaryPending = false
        this.maxDivergencePercent = DEFAULT_MAX_DIVERGENCE_PERCENT
        this.effective = message.effective
        this.warnings = message.warnings
        this.numThreads = getDefaultThreadCount(message.warningSummary, this.maxThreads)
        this.error = ''
        this.stopTimer()
        this.state = 'ready'
        return
      }

      if (message.type === 'warning-summary') {
        const summary = message.warningSummary
        if (
          summary.filterDivergentSamples === this.filterDivergentSamples &&
          Math.abs(summary.maxDivergencePercent - this.maxDivergencePercent) <= 0.01 &&
          constantSitesEqual(summary.constantSites, this.getActiveConstantSites())
        ) {
          this.warningSummary = summary
          this.warningSummaryPending = false
        }
        return
      }

      this.error = ''
      this.newick = message.newick
      this.logLikelihood = message.logLikelihood
      this.effective = message.effective
      this.warnings = message.warnings
      this.stopTimer()
      this.state = 'done'
    }

    this.worker.onerror = (event) => {
      this.error = event.message || 'The CMAPLE worker failed.'
      this.stopTimer()
      this.state = 'error'
    }

    return this.worker
  }
}

export type CmapleAppController = CmapleApp

export function createCmapleApp() {
  return new CmapleApp()
}
