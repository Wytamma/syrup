import {
  DEFAULT_MAX_DIVERGENCE_PERCENT,
  ZERO_CONSTANT_SITES,
  constantSitesEqual,
  formatConstantSites,
  getAdjustedDivergence,
  getAdjustedSequenceLength,
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
  SequenceType,
  SubstitutionModel,
  TreeSearchType,
} from '../../types/cmaple'

export type AppState = 'idle' | 'preflight' | 'ready' | 'running' | 'done' | 'error'

const ALIGNMENT_QUERY_PARAM = 'alignment'
const STARTING_TREE_QUERY_PARAMS = ['startingTree']
const STARTING_ALIGNMENT_QUERY_PARAMS = ['startingAlignment']
const DNA_MODELS: SubstitutionModel[] = ['GTR', 'JC', 'UNREST']
const PROTEIN_MODELS: SubstitutionModel[] = [
  'LG',
  'WAG',
  'JTT',
  'GTR20',
  'NONREV',
  'Q.PFAM',
  'Q.BIRD',
  'Q.MAMMAL',
  'Q.INSECT',
  'Q.PLANT',
  'Q.YEAST',
  'JTTDCMUT',
  'DCMUT',
  'VT',
  'PMB',
  'BLOSUM62',
  'DAYHOFF',
  'MTREV',
  'MTART',
  'MTZOA',
  'MTMET',
  'MTVER',
  'MTINV',
  'MTMAM',
  'FLAVI',
  'HIVB',
  'HIVW',
  'FLU',
  'RTREV',
  'CPREV',
  'NQ.PFAM',
  'NQ.BIRD',
  'NQ.MAMMAL',
  'NQ.INSECT',
  'NQ.PLANT',
  'NQ.YEAST',
]

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
    nexus: '',
    logLikelihood: null as number | null,
    showInternalLabels: false,
    showLeafLabels: true,
    elapsedMs: 0,
    didCopyNewick: false,
    didDownloadNewick: false,
    isExportingMaple: false,
    numThreads: 1,
    maxThreads: Math.max(1, navigator.hardwareConcurrency || 1),
    substitutionModel: 'GTR' as SubstitutionModel,
    branchSupportMethod: 'sprta' as BranchSupportMethod,
    branchSupportReplicates: 1000,
    branchSupportEpsilon: 0.1,
    filterDivergentSamples: false,
    maxDivergencePercent: DEFAULT_MAX_DIVERGENCE_PERCENT,
    useConstantSites: false,
    constantSites: { a: 0, c: 0, g: 0, t: 0 } as ConstantSiteCounts,
    constantSitesText: formatConstantSites(ZERO_CONSTANT_SITES),
    startingTreeFileName: '',
    startingTreeText: '',
    startingAlignmentFileName: '',
    startingAlignmentText: '',
    branchLengthsFixed: false,
    noReroot: false,
    treeSearchType: 'normal' as TreeSearchType,
    estimateMat: false,

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
    setSubstitutionModel,
    setBranchSupportMethod,
    setBranchSupportReplicates,
    setBranchSupportEpsilon,
    setFilterDivergentSamples,
    setMaxDivergencePercent,
    setConstantSiteCountsFromText,
    setConstantSitesText,
    setUseConstantSites,
    setStartingTreeFile,
    setStartingAlignmentFile,
    setBranchLengthsFixed,
    setNoReroot,
    setTreeSearchType,
    setEstimateMat,
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

  function getFirstQueryParam(params: URLSearchParams, names: string[]) {
    for (const name of names) {
      const value = params.get(name)
      if (value) return value
    }
    return ''
  }

  async function loadAlignmentFromQueryParam() {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const alignmentUrl = params.get(ALIGNMENT_QUERY_PARAM)
    const startingTreeUrl = getFirstQueryParam(params, STARTING_TREE_QUERY_PARAMS)
    const startingAlignmentUrl = getFirstQueryParam(params, STARTING_ALIGNMENT_QUERY_PARAMS)
    if (!alignmentUrl) return

    try {
      const [startingTreeFile, startingAlignmentFile] = await Promise.all([
        startingTreeUrl ? downloadTextFileFromUrl(startingTreeUrl, 'starting-tree.nwk') : Promise.resolve(null),
        startingAlignmentUrl ? downloadTextFileFromUrl(startingAlignmentUrl, 'starting-alignment.maple') : Promise.resolve(null),
      ])

      if (startingTreeFile) await setStartingTreeFile(startingTreeFile)
      if (startingAlignmentFile) await setStartingAlignmentFile(startingAlignmentFile)
      await loadAlignmentFromUrl(alignmentUrl)
    } catch (err) {
      app.error = err instanceof Error ? err.message : 'Could not download files from the URL parameters.'
      app.logs = []
      app.state = 'error'
    }
  }

  function requestWarningSummary() {
    if (!app.currentId || app.state !== 'ready') return
    app.warningSummaryPending = app.filterDivergentSamples
    getWorker().postMessage({
      type: 'summarize-filter',
      id: app.currentId,
      filterDivergentSamples: app.filterDivergentSamples,
      maxDivergencePercent: app.maxDivergencePercent,
      constantSites: sanitizeConstantSites(getActiveConstantSites()),
    })
  }

  function refreshEffectiveStatus() {
    if (app.startingAlignmentText) {
      app.effectiveStatus = null
      return
    }

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

    const warnings = getDisplayedWarnings(
      app.stats,
      app.filterDivergentSamples,
      app.divergence,
      app.warningSummary,
      app.warnings,
      app.maxDivergencePercent,
      getActiveConstantSites(),
    )
    app.displayedWarnings = warnings
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

  function setSubstitutionModel(value: SubstitutionModel) {
    app.substitutionModel = value
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
    refreshDerivedAlignmentState()
    if (app.filterDivergentSamples) requestWarningSummary()
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

  async function setStartingTreeFile(file: File | null) {
    if (!file) {
      app.startingTreeFileName = ''
      app.startingTreeText = ''
      app.startingAlignmentFileName = ''
      app.startingAlignmentText = ''
      app.branchLengthsFixed = false
      app.noReroot = false
      refreshDerivedAlignmentState()
      return
    }

    try {
      app.startingTreeFileName = file.name
      app.startingTreeText = await file.text()
      app.startingAlignmentFileName = ''
      app.startingAlignmentText = ''
      app.error = ''
      refreshDerivedAlignmentState()
    } catch (err) {
      app.startingTreeFileName = ''
      app.startingTreeText = ''
      app.startingAlignmentFileName = ''
      app.startingAlignmentText = ''
      app.branchLengthsFixed = false
      app.noReroot = false
      app.error = err instanceof Error ? err.message : 'Could not read the selected tree file.'
      refreshDerivedAlignmentState()
    }
  }

  async function setStartingAlignmentFile(file: File | null) {
    if (!file || !app.startingTreeText) {
      app.startingAlignmentFileName = ''
      app.startingAlignmentText = ''
      refreshDerivedAlignmentState()
      return
    }

    try {
      app.startingAlignmentFileName = file.name
      app.startingAlignmentText = await file.text()
      app.error = ''
      refreshDerivedAlignmentState()
    } catch (err) {
      app.startingAlignmentFileName = ''
      app.startingAlignmentText = ''
      app.error = err instanceof Error ? err.message : 'Could not read the selected starting alignment file.'
      refreshDerivedAlignmentState()
    }
  }

  function setBranchLengthsFixed(value: boolean) {
    app.branchLengthsFixed = value && !!app.startingTreeText
  }

  function setNoReroot(value: boolean) {
    app.noReroot = value && !!app.startingTreeText
  }

  function setTreeSearchType(value: TreeSearchType) {
    app.treeSearchType = value
  }

  function setEstimateMat(value: boolean) {
    app.estimateMat = value
  }

  function getSupportedModels(sequenceType: SequenceType) {
    return sequenceType === 'protein' ? PROTEIN_MODELS : DNA_MODELS
  }

  function getDefaultSubstitutionModel(sequenceType: SequenceType): SubstitutionModel {
    return sequenceType === 'protein' ? 'LG' : 'GTR'
  }

  function normalizeSubstitutionModel(sequenceType: SequenceType) {
    if (!getSupportedModels(sequenceType).includes(app.substitutionModel)) {
      app.substitutionModel = getDefaultSubstitutionModel(sequenceType)
    }
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
    app.startingTreeFileName = ''
    app.startingTreeText = ''
    app.startingAlignmentFileName = ''
    app.startingAlignmentText = ''
    app.branchLengthsFixed = false
    app.noReroot = false
    app.treeSearchType = 'normal'
    app.estimateMat = false
    app.logs = []
    app.newick = ''
    app.nexus = ''
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

    const fallbackName = getFileNameFromUrl(trimmedUrl, 'alignment.fa')

    try {
      app.logs = [`Downloading alignment from ${trimmedUrl}`]

      const file = await downloadTextFileFromUrl(trimmedUrl, fallbackName)
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
    app.logs = []
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    app.newick = ''
    app.nexus = ''
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
    const maxDivergencePercent = Number(app.maxDivergencePercent)
    app.maxDivergencePercent = Math.max(
      0,
      Number.isFinite(maxDivergencePercent) ? maxDivergencePercent : DEFAULT_MAX_DIVERGENCE_PERCENT,
    )
    app.error = ''
    app.logs = []
    pendingLogLines = []
    if (logFlushId !== null) {
      cancelAnimationFrame(logFlushId)
      logFlushId = null
    }
    startTimer()
    app.state = 'running'
    normalizeSubstitutionModel(app.stats?.sequenceType ?? 'dna')
    getWorker().postMessage({
      type: 'infer',
      id: app.currentId,
      numThreads: app.numThreads,
      substitutionModel: app.substitutionModel,
      branchSupportMethod: app.branchSupportMethod,
      branchSupportReplicates: app.branchSupportReplicates,
      branchSupportEpsilon: app.branchSupportEpsilon,
      filterDivergentSamples: app.filterDivergentSamples,
      maxDivergencePercent: app.maxDivergencePercent,
      constantSites: sanitizeConstantSites(app.activeConstantSites),
      startingTreeText: app.startingTreeText,
      startingAlignmentText: app.startingAlignmentText,
      branchLengthsFixed: app.branchLengthsFixed,
      noReroot: app.noReroot,
      treeSearchType: app.treeSearchType,
      estimateMat: app.estimateMat,
    })
  }

  async function copyNewick() {
    if (!app.newick) return
    await navigator.clipboard.writeText(app.newick)
    showActionFeedback('copy')
  }

  function downloadNewick() {
    if (!app.newick) return
    const content = app.nexus || app.newick
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = app.fileName.replace(/\.[^.]+$/, '') || 'cmaple-tree'
    link.href = url
    link.download = app.nexus ? `${baseName}.mat.nex` : `${baseName}.nwk`
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

  async function downloadTextFileFromUrl(url: string, fallbackName: string) {
    const trimmedUrl = url.trim()
    const response = await fetch(trimmedUrl)
    const fileName = getFileNameFromUrl(trimmedUrl, fallbackName)
    if (!response.ok) {
      throw new Error(`Could not download ${fileName} (${response.status} ${response.statusText}).`)
    }

    const text = await response.text()
    if (/^\s*<!doctype\s+html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
      throw new Error(`${fileName} did not return an alignment or tree file. Check the URL path.`)
    }

    return new File([text], fileName, {
      type: response.headers.get('content-type') || 'text/plain',
    })
  }

  function getFileNameFromUrl(url: string, fallbackName: string) {
    try {
      if (url.startsWith('http') || url.startsWith('ftp')) {
        const parsedUrl = new URL(url)
        const fromPath = parsedUrl.pathname.split('/').filter(Boolean).at(-1)
        return fromPath || fallbackName
      }
      const fromPath = url.split('/').filter(Boolean).at(-1)
      return fromPath || fallbackName
    } catch {
      return fallbackName
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
        normalizeSubstitutionModel(message.stats.sequenceType)
        setDivergence(message.divergence)
        app.warningSummary = message.warningSummary
        app.warningSummaryPending = false
        app.maxDivergencePercent = DEFAULT_MAX_DIVERGENCE_PERCENT
        app.effective = message.effective
        app.warnings = message.warnings
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
      app.nexus = message.nexus ?? ''
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
