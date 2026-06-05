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
import type {
  AlignmentStats,
  AlignmentWarningSummary,
  BranchSupportMethod,
  CmapleWorkerResponse,
  ConstantSiteCounts,
  DivergenceSummary,
} from '../../types/cmaple'

export type AppState = 'idle' | 'preflight' | 'ready' | 'running' | 'done' | 'error'

const ALIGNMENT_QUERY_PARAM = 'alignment'

export function createCmapleApp() {
  let worker: Worker | null = null
  let timerId: number | null = null
  let copyFeedbackTimer: number | null = null
  let downloadFeedbackTimer: number | null = null
  let logFlushId: number | null = null
  let pendingLogLines: string[] = []
  let divergenceData: DivergenceSummary | null = null

  const app = $state({
    state: 'idle' as AppState,
    currentId: '',
    selectedFile: null as File | null,
    fileName: '',
    error: '',
    stats: null as AlignmentStats | null,
    divergenceVersion: 0,
    warningSummary: null as AlignmentWarningSummary | null,
    effective: null as boolean | null,
    effectiveStatus: null as boolean | null,
    warnings: [] as string[],
    displayedWarnings: [] as string[],
    warningSummaryPending: false,
    logs: [] as string[],
    newick: '',
    logLikelihood: null as number | null,
    showInternalLabels: false,
    showLeafLabels: true,
    elapsedMs: 0,
    didCopyNewick: false,
    didDownloadNewick: false,
    isExportingMaple: false,
    numThreads: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)),
    maxThreads: Math.max(1, navigator.hardwareConcurrency || 1),
    branchSupportMethod: 'sprta' as BranchSupportMethod,
    branchSupportReplicates: 1000,
    branchSupportEpsilon: 0.1,
    filterDivergentSamples: false,
    maxDivergencePercent: DEFAULT_MAX_DIVERGENCE_PERCENT,
    useConstantSites: false,
    constantSites: { a: 0, c: 0, g: 0, t: 0 } as ConstantSiteCounts,
    constantSitesText: formatConstantSites(ZERO_CONSTANT_SITES),

    get divergence() {
      app.divergenceVersion
      return divergenceData
    },
    get activeConstantSites() {
      return app.useConstantSites ? app.constantSites : ZERO_CONSTANT_SITES
    },
    get adjustedSequenceLength() {
      return getAdjustedSequenceLength(app.stats, app.activeConstantSites)
    },
    destroy,
    loadAlignmentFromQueryParam,
    requestWarningSummary,
    setNumThreads,
    setBranchSupportMethod,
    setBranchSupportReplicates,
    setBranchSupportEpsilon,
    setFilterDivergentSamples,
    setMaxDivergencePercent,
    setConstantSiteCountsFromText,
    setConstantSitesText,
    setUseConstantSites,
    clearCurrent,
    loadAlignmentFromUrl,
    loadFile,
    runInference,
    copyNewick,
    downloadNewick,
    downloadMaple,
    toggleInternalLabels,
    toggleLeafLabels,
    returnToRunSettings,
  })

  function destroy() {
    clearFeedbackTimer('copy')
    clearFeedbackTimer('download')
    flushLogLines()
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    if (app.currentId) worker?.postMessage({ type: 'clear', id: app.currentId })
    stopTimer()
    worker?.terminate()
    worker = null
  }

  function loadAlignmentFromQueryParam() {
    if (typeof window === 'undefined') return
    const alignmentUrl = new URLSearchParams(window.location.search).get(ALIGNMENT_QUERY_PARAM)
    if (alignmentUrl) void loadAlignmentFromUrl(alignmentUrl)
  }

  function requestWarningSummary() {
    if (!app.currentId || app.state !== 'ready') return
    app.warningSummaryPending = app.filterDivergentSamples
    getWorker().postMessage({
      type: 'summarize-filter',
      id: app.currentId,
      filterDivergentSamples: app.filterDivergentSamples,
      maxDivergencePercent: app.maxDivergencePercent,
      constantSites: getActiveConstantSites(),
    })
  }

  function refreshEffectiveStatus() {
    app.effectiveStatus = getEffectiveStatus(
      app.stats,
      getAdjustedDivergence(app.divergence, app.stats, getActiveConstantSites()),
      app.filterDivergentSamples,
      app.maxDivergencePercent,
      getActiveConstantSites(),
      app.effective,
    )
  }

  function refreshDisplayedWarnings() {
    if (
      app.warningSummaryPending &&
      !isCurrentWarningSummary(app.warningSummary, app.filterDivergentSamples, app.maxDivergencePercent, getActiveConstantSites())
    ) {
      return
    }

    app.displayedWarnings = getDisplayedWarnings(
      app.stats,
      app.filterDivergentSamples,
      app.divergence,
      app.warningSummary,
      app.warnings,
      app.maxDivergencePercent,
      getActiveConstantSites(),
    )
  }

  function refreshDerivedAlignmentState() {
    refreshEffectiveStatus()
    refreshDisplayedWarnings()
  }

  function setDivergence(value: DivergenceSummary | null) {
    divergenceData = value
    app.divergenceVersion += 1
  }

  function setNumThreads(value: number) {
    app.numThreads = Math.max(1, Math.min(app.maxThreads, Math.floor(Number(value) || 1)))
  }

  function setBranchSupportMethod(value: BranchSupportMethod) {
    app.branchSupportMethod = value
  }

  function setBranchSupportReplicates(value: number) {
    app.branchSupportReplicates = value
  }

  function setBranchSupportEpsilon(value: number) {
    app.branchSupportEpsilon = value
  }

  function setFilterDivergentSamples(value: boolean) {
    app.filterDivergentSamples = value
    if (!value) app.warningSummaryPending = false
    refreshDerivedAlignmentState()
    requestWarningSummary()
  }

  function setMaxDivergencePercent(value: number) {
    app.maxDivergencePercent = value
    app.warningSummaryPending = false
    refreshDerivedAlignmentState()
  }

  function setConstantSiteCountsFromText(value = app.constantSitesText, shouldRequestWarningSummary = true) {
    app.constantSitesText = value
    const parsedCounts = parseConstantSites(value)
    if (!parsedCounts) return
    const hasConstantSites = getTotalConstantSites(parsedCounts) > 0
    app.constantSites = parsedCounts
    if (hasConstantSites) app.useConstantSites = true
    refreshDerivedAlignmentState()
    if (shouldRequestWarningSummary && app.filterDivergentSamples) requestWarningSummary()
  }

  function setConstantSitesText(value: string) {
    app.constantSitesText = value
  }

  function setUseConstantSites(value: boolean) {
    setConstantSiteCountsFromText(app.constantSitesText, false)
    app.useConstantSites = value
    refreshDerivedAlignmentState()
    if (app.filterDivergentSamples) requestWarningSummary()
  }

  function clearCurrent() {
    if (app.currentId) {
      worker?.postMessage({ type: 'clear', id: app.currentId })
    }
    app.currentId = ''
    app.selectedFile = null
    app.fileName = ''
    app.error = ''
    app.stats = null
    setDivergence(null)
    app.warningSummary = null
    app.warningSummaryPending = false
    app.effective = null
    app.effectiveStatus = null
    app.warnings = []
    app.displayedWarnings = []
    app.useConstantSites = false
    app.constantSites = { a: 0, c: 0, g: 0, t: 0 }
    app.constantSitesText = formatConstantSites(app.constantSites)
    app.logs = []
    app.newick = ''
    app.logLikelihood = null
    app.showInternalLabels = false
    app.showLeafLabels = true
    app.didCopyNewick = false
    app.didDownloadNewick = false
    app.isExportingMaple = false
    clearFeedbackTimer('copy')
    clearFeedbackTimer('download')
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    app.elapsedMs = 0
    stopTimer()
    app.state = 'idle'
  }

  async function loadAlignmentFromUrl(url: string) {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return

    const fallbackName = getAlignmentFileNameFromUrl(trimmedUrl)

    try {
      app.logs = [`Downloading alignment from ${trimmedUrl}`]

      const response = await fetch(trimmedUrl)
      if (!response.ok) {
        throw new Error(`Could not download alignment (${response.status} ${response.statusText}).`)
      }

      const blob = await response.blob()
      const file = new File([blob], fallbackName, {
        type: blob.type || 'text/plain',
      })

      await loadFile(file)
    } catch (err) {
      app.selectedFile = null
      app.fileName = fallbackName
      app.error = err instanceof Error ? err.message : 'Could not download the alignment from the provided URL.'
      app.logs = []
      app.state = 'error'
    }
  }

  async function loadFile(file: File) {
    if (app.currentId) worker?.postMessage({ type: 'clear', id: app.currentId })

    app.currentId = crypto.randomUUID()
    app.selectedFile = file
    app.fileName = file.name
    app.error = ''
    app.stats = null
    setDivergence(null)
    app.warningSummary = null
    app.warningSummaryPending = false
    app.effective = null
    app.effectiveStatus = null
    app.warnings = []
    app.displayedWarnings = []
    app.useConstantSites = false
    app.constantSites = { a: 0, c: 0, g: 0, t: 0 }
    app.constantSitesText = formatConstantSites(app.constantSites)
    app.logs = []
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    app.newick = ''
    app.logLikelihood = null
    app.state = 'preflight'
    startTimer()

    try {
      const data = new Uint8Array(await file.arrayBuffer())
      getWorker().postMessage(
        {
          type: 'load',
          id: app.currentId,
          fileName: file.name,
          format: 'auto',
          data,
        },
        [data.buffer],
      )
    } catch (err) {
      stopTimer()
      app.error = err instanceof Error ? err.message : 'Could not read the selected file.'
      app.state = 'error'
    }
  }

  function runInference() {
    if (!app.currentId || app.state !== 'ready') return
    app.branchSupportReplicates = Math.max(1, Math.floor(Number(app.branchSupportReplicates) || 1000))
    app.branchSupportEpsilon = Math.max(0, Number(app.branchSupportEpsilon) || 0.1)
    app.maxDivergencePercent = Math.max(0, Number(app.maxDivergencePercent) || DEFAULT_MAX_DIVERGENCE_PERCENT)
    app.error = ''
    app.logs = []
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    startTimer()
    app.state = 'running'
    getWorker().postMessage({
      type: 'infer',
      id: app.currentId,
      numThreads: app.numThreads,
      branchSupportMethod: app.branchSupportMethod,
      branchSupportReplicates: app.branchSupportReplicates,
      branchSupportEpsilon: app.branchSupportEpsilon,
      filterDivergentSamples: app.filterDivergentSamples,
      maxDivergencePercent: app.maxDivergencePercent,
      constantSites: sanitizeConstantSites(app.activeConstantSites),
    })
  }

  async function copyNewick() {
    if (!app.newick) return
    await navigator.clipboard.writeText(app.newick)
    showActionFeedback('copy')
  }

  function downloadNewick() {
    if (!app.newick) return
    const blob = new Blob([app.newick], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = app.fileName.replace(/\.[^.]+$/, '') || 'cmaple-tree'
    link.href = url
    link.download = `${baseName}.nwk`
    link.click()
    URL.revokeObjectURL(url)
    showActionFeedback('download')
  }

  function downloadMaple() {
    if (!app.currentId || app.state === 'preflight' || app.state === 'running') return
    app.isExportingMaple = true
    app.error = ''
    getWorker().postMessage({
      type: 'export-maple',
      id: app.currentId,
    })
  }

  function toggleInternalLabels() {
    app.showInternalLabels = !app.showInternalLabels
  }

  function toggleLeafLabels() {
    app.showLeafLabels = !app.showLeafLabels
  }

  function returnToRunSettings() {
    if (!app.currentId || !app.stats) return
    app.error = ''
    app.logs = []
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    app.elapsedMs = 0
    stopTimer()
    app.state = 'ready'
  }

  function getActiveConstantSites() {
    return app.useConstantSites ? app.constantSites : ZERO_CONSTANT_SITES
  }

  function getAlignmentFileNameFromUrl(url: string) {
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

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId)
      timerId = null
    }
  }

  function queueLogLines(lines: string[]) {
    pendingLogLines.push(...lines)
    if (logFlushId !== null) return

    logFlushId = requestAnimationFrame(() => {
      logFlushId = null
      flushLogLines()
    })
  }

  function flushLogLines() {
    if (!pendingLogLines.length) return
    app.logs = [...app.logs, ...pendingLogLines].slice(-220)
    pendingLogLines = []
  }

  function startTimer() {
    const startedAt = Date.now()
    app.elapsedMs = 0
    stopTimer()
    timerId = window.setInterval(() => {
      app.elapsedMs = Date.now() - startedAt
    }, 250)
  }

  function clearFeedbackTimer(kind: 'copy' | 'download') {
    const timer = kind === 'copy' ? copyFeedbackTimer : downloadFeedbackTimer
    if (timer !== null) {
      window.clearTimeout(timer)
    }

    if (kind === 'copy') copyFeedbackTimer = null
    else downloadFeedbackTimer = null
  }

  function showActionFeedback(kind: 'copy' | 'download') {
    clearFeedbackTimer(kind)

    if (kind === 'copy') {
      app.didCopyNewick = true
      copyFeedbackTimer = window.setTimeout(() => {
        app.didCopyNewick = false
        copyFeedbackTimer = null
      }, 1400)
      return
    }

    app.didDownloadNewick = true
    downloadFeedbackTimer = window.setTimeout(() => {
      app.didDownloadNewick = false
      downloadFeedbackTimer = null
    }, 1400)
  }

  function getWorker() {
    if (worker) return worker

    worker = new Worker(new URL('../../cmaple.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<CmapleWorkerResponse>) => {
      const message = event.data
      if ('id' in message && message.id && message.id !== app.currentId) return

      if (message.type === 'log') {
        const lines = message.message
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length) queueLogLines(lines)
        return
      }

      if (message.type === 'error') {
        app.error = message.error
        app.isExportingMaple = false
        app.warningSummaryPending = false
        stopTimer()
        app.state = app.stats ? 'ready' : 'error'
        return
      }

      if (message.type === 'preflight') {
        app.stats = message.stats
        setDivergence(message.divergence)
        app.warningSummary = message.warningSummary
        app.warningSummaryPending = false
        app.maxDivergencePercent = DEFAULT_MAX_DIVERGENCE_PERCENT
        app.effective = message.effective
        app.warnings = message.warnings
        app.numThreads = getDefaultThreadCount(message.warningSummary, app.maxThreads)
        app.error = ''
        refreshDerivedAlignmentState()
        stopTimer()
        app.state = 'ready'
        return
      }

      if (message.type === 'warning-summary') {
        const summary = message.warningSummary
        if (
          summary.filterDivergentSamples === app.filterDivergentSamples &&
          Math.abs(summary.maxDivergencePercent - app.maxDivergencePercent) <= 0.01 &&
          constantSitesEqual(summary.constantSites, getActiveConstantSites())
        ) {
          app.warningSummary = summary
          app.warningSummaryPending = false
          refreshDerivedAlignmentState()
        }
        return
      }

      if (message.type === 'maple-export') {
        const blob = new Blob([message.maple], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        const baseName = app.fileName.replace(/\.[^.]+$/, '') || 'alignment'
        link.href = url
        link.download = `${baseName}.maple`
        link.click()
        URL.revokeObjectURL(url)
        app.isExportingMaple = false
        return
      }

      app.error = ''
      flushLogLines()
      app.newick = message.newick
      app.logLikelihood = message.logLikelihood
      app.effective = message.effective
      app.effectiveStatus = message.effective
      app.warnings = message.warnings
      stopTimer()
      app.state = 'done'
    }

    worker.onerror = (event) => {
      app.error = event.message || 'The CMAPLE worker failed.'
      stopTimer()
      app.state = 'error'
    }

    return worker
  }

  return app
}

export type CmapleAppController = ReturnType<typeof createCmapleApp>
