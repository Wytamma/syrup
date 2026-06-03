<script lang="ts">
  import { afterUpdate, onDestroy, onMount } from 'svelte'
  import AppTopbar from './lib/components/AppTopbar.svelte'
  import DivergenceQualityFilter from './lib/components/DivergenceQualityFilter.svelte'
  import SyrupLogo from './lib/components/SyrupLogo.svelte'
  import TreeViewer from './lib/components/TreeViewer.svelte'
  import type { AlignmentStats, AlignmentWarningSummary, CmapleWorkerResponse, DivergenceSummary } from './types/cmaple'

  type AppState = 'idle' | 'preflight' | 'ready' | 'running' | 'done' | 'error'
  type ThemeMode = 'dark' | 'light'

  const THEME_STORAGE_KEY = 'syrup-theme'
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'
  const ALIGNMENT_QUERY_PARAM = 'alignment'
  const DEFAULT_MAX_DIVERGENCE_PERCENT = 6.7
  const CMAPLE_MAX_SUBS_PER_SITE = 0.067
  const CMAPLE_MEAN_SUBS_PER_SITE = 0.02
  const LARGE_ALIGNMENT_SITE_COUNT = 50_000_000
  const LONG_RUN_RECOMMENDATION =
    'Consider turning off SH-aLRT support or lowering the number of replicates for a faster less robust analysis.'

  let worker: Worker | null = null
  let state: AppState = 'idle'
  let currentId = ''
  let selectedFile: File | null = null
  let fileName = ''
  let isDragging = false
  let error = ''
  let stats: AlignmentStats | null = null
  let divergence: DivergenceSummary | null = null
  let warningSummary: AlignmentWarningSummary | null = null
  let effective: boolean | null = null
  let warnings: string[] = []
  let displayedWarnings: string[] = []
  let warningSummaryPending = false
  let logs: string[] = []
  let newick = ''
  let logLikelihood: number | null = null
  let showInternalLabels = false
  let showLeafLabels = true
  let elapsedMs = 0
  let timerId: number | null = null
  let logLinesElement: HTMLDivElement | null = null
  let lastScrolledLogCount = 0
  let dropzoneInput: HTMLInputElement | null = null
  let advancedOptionsElement: HTMLDetailsElement | null = null
  let copyFeedbackTimer: number | null = null
  let downloadFeedbackTimer: number | null = null
  let didCopyNewick = false
  let didDownloadNewick = false
  let numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 1)
  let computeBranchSupport = true
  let branchSupportReplicates = 1000
  let filterDivergentSamples = false
  let maxDivergencePercent = DEFAULT_MAX_DIVERGENCE_PERCENT
  let theme: ThemeMode = 'dark'
  let systemThemeMedia: MediaQueryList | null = null

  afterUpdate(() => {
    if (state === 'running' && logs.length !== lastScrolledLogCount && logLinesElement) {
      logLinesElement.scrollTop = logLinesElement.scrollHeight
    }
    lastScrolledLogCount = logs.length
  })

  $: nextDisplayedWarnings = getDisplayedWarnings(
    stats,
    filterDivergentSamples,
    divergence,
    warningSummary,
    warnings,
    maxDivergencePercent,
  )
  $: if (!warningSummaryPending || isCurrentWarningSummary(warningSummary, filterDivergentSamples, maxDivergencePercent)) {
    displayedWarnings = nextDisplayedWarnings
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatElapsed(ms: number) {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  function getIncludedSampleCount() {
    const scores = divergence?.sampleScores ?? []
    return countIncludedSamples(scores, filterDivergentSamples, maxDivergencePercent)
  }

  function countIncludedSamples(scores: number[], isFilterEnabled: boolean, threshold: number) {
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

  function getEffectiveStatus() {
    if (!stats || !divergence || !filterDivergentSamples) return effective

    const includedCount = getIncludedSampleCount()
    if (includedCount < 3) return false

    const maxMutations = stats.sequenceLength * CMAPLE_MAX_SUBS_PER_SITE
    let remainingMutationBudget = stats.sequenceLength * CMAPLE_MEAN_SUBS_PER_SITE * includedCount

    for (let index = 0; index < includedCount; index += 1) {
      const mutationCount = divergence.cmapleMutationCounts[index] ?? 0
      if (mutationCount > maxMutations) return false
      remainingMutationBudget -= mutationCount
      if (remainingMutationBudget < 0) return false
    }

    return true
  }

  function getDisplayedWarnings(
    currentStats: AlignmentStats | null,
    isFilterEnabled: boolean,
    currentDivergence: DivergenceSummary | null,
    currentWarningSummary: AlignmentWarningSummary | null,
    currentWarnings: string[],
    currentThreshold: number,
  ) {
    if (!currentStats || !isFilterEnabled || !currentDivergence) return currentWarnings
    if (
      !currentWarningSummary ||
      currentWarningSummary.filterDivergentSamples !== isFilterEnabled ||
      Math.abs(currentWarningSummary.maxDivergencePercent - currentThreshold) > 0.01
    ) {
      return currentWarnings
    }

    return getWarningsForSummary(currentWarningSummary, currentStats.sequenceCount)
  }

  function isCurrentWarningSummary(
    currentWarningSummary: AlignmentWarningSummary | null,
    isFilterEnabled: boolean,
    currentThreshold: number,
  ) {
    if (!isFilterEnabled) return true
    return (
      !!currentWarningSummary &&
      currentWarningSummary.filterDivergentSamples === isFilterEnabled &&
      Math.abs(currentWarningSummary.maxDivergencePercent - currentThreshold) <= 0.01
    )
  }

  function getWarningsForSummary(summary: AlignmentWarningSummary, originalSequenceCount: number) {
    const isLargeAlignment = summary.sequenceCount * summary.sequenceLength >= LARGE_ALIGNMENT_SITE_COUNT
    const variableColumnsPerKb = summary.sequenceLength ? summary.variableColumns / (summary.sequenceLength / 1000) : 0
    const hasDenseVariation = summary.variableColumns >= 2000 && variableColumnsPerKb >= 50
    const hasSubstantialAmbiguity = summary.meanAmbiguousSites >= 100 && summary.ambiguousFraction >= 0.01
    const hasDifficultVariation = hasDenseVariation && hasSubstantialAmbiguity

    if (!isLargeAlignment && !hasDifficultVariation) return []

    const details = [
      hasDifficultVariation ? `${summary.variableColumns.toLocaleString()} variable columns` : '',
      hasDifficultVariation
        ? `${Math.round(summary.meanAmbiguousSites).toLocaleString()} ambiguous sites per sequence on average`
        : '',
    ].filter(Boolean)
    const prefix =
      summary.filterDivergentSamples && summary.removedCount > 0
        ? `With the current filter, ${summary.sequenceCount.toLocaleString()} of ${originalSequenceCount.toLocaleString()} samples will be analyzed (${summary.removedCount.toLocaleString()} removed). `
        : ''
    return [
      [
        prefix,
        isLargeAlignment
          ? 'This is a large alignment and may take several minutes in the browser, especially with SH-aLRT support enabled.'
          : 'This alignment may take several minutes in the browser, especially with SH-aLRT support enabled.',
        details.length ? ` It has ${details.join(' and ')}.` : '',
        ' ',
        LONG_RUN_RECOMMENDATION,
      ].join(''),
    ]
  }

  function requestWarningSummary() {
    if (!currentId || state !== 'ready') return
    warningSummaryPending = filterDivergentSamples
    getWorker().postMessage({
      type: 'summarize-filter',
      id: currentId,
      filterDivergentSamples,
      maxDivergencePercent,
    })
  }

  function setFilterDivergentSamples(value: boolean) {
    filterDivergentSamples = value
    if (!value) warningSummaryPending = false
    requestWarningSummary()
  }

  function setMaxDivergencePercent(value: number) {
    maxDivergencePercent = value
    requestWarningSummary()
  }

  function setTheme(nextTheme: ThemeMode) {
    theme = nextTheme

    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = nextTheme
      document.documentElement.style.colorScheme = nextTheme
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    }
  }

  function getSystemTheme(): ThemeMode {
    return typeof window !== 'undefined' && window.matchMedia(SYSTEM_THEME_QUERY).matches ? 'dark' : 'light'
  }

  function hasStoredThemeOverride() {
    if (typeof localStorage === 'undefined') return false
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    return storedTheme === 'dark' || storedTheme === 'light'
  }

  function handleSystemThemeChange() {
    if (hasStoredThemeOverride()) return
    setTheme(getSystemTheme())
  }

  function toggleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId)
      timerId = null
    }
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
      didCopyNewick = true
      copyFeedbackTimer = window.setTimeout(() => {
        didCopyNewick = false
        copyFeedbackTimer = null
      }, 1400)
      return
    }

    didDownloadNewick = true
    downloadFeedbackTimer = window.setTimeout(() => {
      didDownloadNewick = false
      downloadFeedbackTimer = null
    }, 1400)
  }

  function startTimer() {
    const startedAt = Date.now()
    elapsedMs = 0
    stopTimer()
    timerId = window.setInterval(() => {
      elapsedMs = Date.now() - startedAt
    }, 250)
  }

  function getWorker() {
    if (worker) return worker

    worker = new Worker(new URL('./cmaple.worker.ts', import.meta.url), {
      type: 'module',
    })

    worker.onmessage = (event: MessageEvent<CmapleWorkerResponse>) => {
      const message = event.data
      if ('id' in message && message.id && message.id !== currentId) return

      if (message.type === 'log') {
        const lines = message.message
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)

        if (lines.length) logs = [...logs, ...lines].slice(-220)
        return
      }

      if (message.type === 'error') {
        error = message.error
        warningSummaryPending = false
        stopTimer()
        state = stats ? 'ready' : 'error'
        return
      }

      if (message.type === 'preflight') {
        stats = message.stats
        divergence = message.divergence
        warningSummary = message.warningSummary
        warningSummaryPending = false
        maxDivergencePercent = DEFAULT_MAX_DIVERGENCE_PERCENT
        effective = message.effective
        warnings = message.warnings
        error = ''
        stopTimer()
        state = 'ready'
        return
      }

      if (message.type === 'warning-summary') {
        const summary = message.warningSummary
        if (
          summary.filterDivergentSamples === filterDivergentSamples &&
          Math.abs(summary.maxDivergencePercent - maxDivergencePercent) <= 0.01
        ) {
          warningSummary = summary
          warningSummaryPending = false
        }
        return
      }

      error = ''
      newick = message.newick
      logLikelihood = message.logLikelihood
      effective = message.effective
      stopTimer()
      state = 'done'
    }

    worker.onerror = (event) => {
      error = event.message || 'The CMAPLE worker failed.'
      stopTimer()
      state = 'error'
    }

    return worker
  }

  function clearCurrent() {
    if (currentId) {
      worker?.postMessage({ type: 'clear', id: currentId })
    }
    currentId = ''
    selectedFile = null
    fileName = ''
    error = ''
    stats = null
    divergence = null
    warningSummary = null
    warningSummaryPending = false
    effective = null
    warnings = []
    logs = []
    newick = ''
    logLikelihood = null
    showInternalLabels = false
    showLeafLabels = true
    didCopyNewick = false
    didDownloadNewick = false
    clearFeedbackTimer('copy')
    clearFeedbackTimer('download')
    elapsedMs = 0
    stopTimer()
    state = 'idle'
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

  async function loadAlignmentFromUrl(url: string) {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return
    
    const fallbackName = getAlignmentFileNameFromUrl(trimmedUrl)

    try {
      logs = [`Downloading alignment from ${trimmedUrl}`]

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
      selectedFile = null
      fileName = fallbackName
      error = err instanceof Error ? err.message : 'Could not download the alignment from the provided URL.'
      logs = []
      state = 'error'
    }
  }

  async function loadFile(file: File) {
    if (currentId) worker?.postMessage({ type: 'clear', id: currentId })

    currentId = crypto.randomUUID()
    selectedFile = file
    fileName = file.name
    error = ''
    stats = null
    divergence = null
    warningSummary = null
    warningSummaryPending = false
    effective = null
    warnings = []
    logs = []
    newick = ''
    logLikelihood = null
    state = 'preflight'
    startTimer()

    try {
      const data = new Uint8Array(await file.arrayBuffer())
      getWorker().postMessage(
        {
          type: 'load',
          id: currentId,
          fileName: file.name,
          format: 'auto',
          data,
        },
        [data.buffer],
      )
    } catch (err) {
      stopTimer()
      error = err instanceof Error ? err.message : 'Could not read the selected file.'
      state = 'error'
    }
  }

  function runInference() {
    if (!currentId || state !== 'ready') return
    if (advancedOptionsElement) advancedOptionsElement.open = false
    branchSupportReplicates = Math.max(1, Math.floor(Number(branchSupportReplicates) || 1000))
    maxDivergencePercent = Math.max(0, Number(maxDivergencePercent) || DEFAULT_MAX_DIVERGENCE_PERCENT)
    error = ''
    logs = []
    startTimer()
    state = 'running'
    getWorker().postMessage({
      type: 'infer',
      id: currentId,
      numThreads,
      computeBranchSupport,
      branchSupportReplicates,
      filterDivergentSamples,
      maxDivergencePercent,
    })
  }

  function handleInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) void loadFile(file)
    input.value = ''
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    isDragging = false
    const file = event.dataTransfer?.files?.[0]
    if (file) void loadFile(file)
  }

  function openFilePicker() {
    dropzoneInput?.click()
  }

  function openDropzonePicker(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.closest('.syrup-tuner') || target.closest('button') || target.closest('input')) return
    openFilePicker()
  }

  function handleDropzoneKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target as HTMLElement
    if (target.closest('.syrup-tuner')) return
    event.preventDefault()
    openFilePicker()
  }

  async function copyNewick() {
    if (!newick) return
    await navigator.clipboard.writeText(newick)
    showActionFeedback('copy')
  }

  function downloadNewick() {
    if (!newick) return
    const blob = new Blob([newick], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = fileName.replace(/\.[^.]+$/, '') || 'cmaple-tree'
    link.href = url
    link.download = `${baseName}.nwk`
    link.click()
    URL.revokeObjectURL(url)
    showActionFeedback('download')
  }

  function toggleInternalLabels() {
    showInternalLabels = !showInternalLabels
  }

  function toggleLeafLabels() {
    showLeafLabels = !showLeafLabels
  }

  function returnToRunSettings() {
    if (!currentId || !stats) return
    error = ''
    logs = []
    elapsedMs = 0
    stopTimer()
    state = 'ready'
  }

  onMount(() => {
    const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null
    setTheme(storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : getSystemTheme())

    if (typeof window !== 'undefined') {
      systemThemeMedia = window.matchMedia(SYSTEM_THEME_QUERY)
      systemThemeMedia.addEventListener('change', handleSystemThemeChange)

      const alignmentUrl = new URLSearchParams(window.location.search).get(ALIGNMENT_QUERY_PARAM)
      if (alignmentUrl) {
        void loadAlignmentFromUrl(alignmentUrl)
      }
    }
  })

  onDestroy(() => {
    clearFeedbackTimer('copy')
    clearFeedbackTimer('download')
    systemThemeMedia?.removeEventListener('change', handleSystemThemeChange)
    if (currentId) worker?.postMessage({ type: 'clear', id: currentId })
    stopTimer()
    worker?.terminate()
  })
</script>

<main class:tree-mode={state === 'done'}>
  {#if state === 'done'}
    <AppTopbar {theme} fixed={true} onToggleTheme={toggleTheme} />

    <TreeViewer {newick} {theme} {showInternalLabels} {showLeafLabels} />
    <div class="tree-dock">
      <div class="tree-toolbar">
        <div>
          <strong>{fileName}</strong>
          <span>{logLikelihood === null ? '' : `Log-likelihood ${Math.round(logLikelihood)}`}</span>
        </div>
        <div class="tree-actions">
          <button
            type="button"
            class="icon-button"
            class:active={showInternalLabels}
            aria-label={showInternalLabels ? 'Hide internal labels' : 'Show internal labels'}
            aria-pressed={showInternalLabels}
            title={showInternalLabels ? 'Hide internal labels' : 'Show internal labels'}
            onclick={toggleInternalLabels}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
              <path d="M6 6h.008v.008H6V6Z" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-button"
            class:active={showLeafLabels}
            aria-label={showLeafLabels ? 'Hide leaf labels' : 'Show leaf labels'}
            aria-pressed={showLeafLabels}
            title={showLeafLabels ? 'Hide leaf labels' : 'Show leaf labels'}
            onclick={toggleLeafLabels}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.75 6.75h16.5M3.75 12H12m-8.25 5.25h16.5" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-button"
            class:success={didCopyNewick}
            aria-label={didCopyNewick ? 'Copied Newick' : 'Copy Newick'}
            title={didCopyNewick ? 'Copied Newick' : 'Copy Newick'}
            onclick={copyNewick}
          >
            {#if didCopyNewick}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0 1 18 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3 1.5 1.5 3-3.75" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15.75 17.25v1.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5A2.25 2.25 0 0 1 6 9h1.5" />
                <path d="M9.75 15h7.5A2.25 2.25 0 0 0 19.5 12.75v-7.5A2.25 2.25 0 0 0 17.25 3h-7.5A2.25 2.25 0 0 0 7.5 5.25v7.5A2.25 2.25 0 0 0 9.75 15Z" />
              </svg>
            {/if}
          </button>
          <button
            type="button"
            class="icon-button"
            class:success={didDownloadNewick}
            aria-label={didDownloadNewick ? 'Downloaded tree' : 'Download tree'}
            title={didDownloadNewick ? 'Downloaded tree' : 'Download tree'}
            onclick={downloadNewick}
          >
            {#if didDownloadNewick}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3v12" />
                <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
                <path d="M3.75 20.25h16.5" />
              </svg>
            {/if}
          </button>
        </div>
      </div>
      <button type="button" class="tree-reset-button" aria-label="Modify run" title="Modify run" onclick={returnToRunSettings}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      </button>
    </div>
  {:else}
    <div class="app-shell">
      <section class="app-frame" aria-label="Syrup landing page">
        <AppTopbar {theme} onToggleTheme={toggleTheme} />

        <div
          class="dropzone"
          role="button"
          tabindex="0"
          class:dragging={isDragging}
          ondragenter={(event) => {
            event.preventDefault()
            isDragging = true
          }}
          ondragover={(event) => event.preventDefault()}
          ondragleave={() => (isDragging = false)}
          ondrop={handleDrop}
          onclick={openDropzonePicker}
          onkeydown={handleDropzoneKeydown}
        >
          <input bind:this={dropzoneInput} type="file" accept=".fa,.fasta,.phy,.phylip,.maple,.txt" onchange={handleInput} />
          <SyrupLogo paused={state === 'running'} />

          <div class="drop-content">
            <span class="drop-kicker">Pandemic scale phylogenetics in your browser</span>
            <span class="drop-title">Add Alignment</span>
            <span class="drop-copy">FASTA, PHYLIP, or MAPLE text files</span>
          </div>

          <span class="drop-hint">Your data never leaves your computer</span>
        </div>
      </section>
    </div>
  {/if}

  {#if state === 'preflight' || state === 'ready' || state === 'running' || state === 'error'}
    <div class="modal-backdrop" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <div>
            <p class="eyebrow">SYRUP (CMAPLE in the browser)</p>
            <h1 id="modal-title">
              {state === 'preflight' ? 'Analyzing alignment' : state === 'running' ? 'Running analysis' : 'Alignment ready'}
            </h1>
          </div>
          {#if state !== 'running'}
            <button type="button" class="ghost" onclick={clearCurrent}>Close</button>
          {/if}
        </div>

        <div class="file-line">
          <strong>{fileName}</strong>
          {#if selectedFile}
            <span>{formatFileSize(selectedFile.size)}</span>
          {/if}
        </div>

        {#if state === 'preflight'}
          <div class="loading">
            <span>Parsing alignment and checking CMAPLE effectiveness.</span>
            <strong aria-live="polite">{formatElapsed(elapsedMs)}</strong>
          </div>
        {:else if state === 'error'}
          <div class="error" role="alert">{error}</div>
          <div class="modal-actions">
            <button type="button" onclick={openFilePicker}>Choose another file</button>
          </div>
        {:else}
          {#if stats}
            <div class="stats-grid">
              <div>
                <span>Format</span>
                <strong>{stats.format.toUpperCase()}</strong>
              </div>
              <div>
                <span>Sequences</span>
                <strong>{stats.sequenceCount.toLocaleString()}</strong>
              </div>
              <div>
                <span>Sequence length</span>
                <strong>{stats.sequenceLength.toLocaleString()}</strong>
              </div>
              <div>
                <span>CMAPLE effective</span>
                <strong>{getEffectiveStatus() ? 'Yes' : 'No'}</strong>
              </div>
            </div>
          {/if}

          {#if error}
            <div class="error" role="alert">{error}</div>
          {/if}

          {#if getEffectiveStatus() === false}
            <div class="warning" role="alert">
              This data is likely not suitable for analysis with CMAPLE.
            </div>
          {/if}

          {#if displayedWarnings.length}
            <div class="warning">{displayedWarnings.join(' ')}</div>
          {/if}

          <div class="options">
            <div class="option-group">
              <span>Threads</span>
              <label class="thread-option">
                <input
                  type="range"
                  min="1"
                  max={maxThreads}
                  bind:value={numThreads}
                  disabled={state === 'running' || !crossOriginIsolated}
                />
                <strong>{numThreads}</strong>
              </label>
            </div>
          </div>

          <details bind:this={advancedOptionsElement} class="advanced-options">
            <summary>Advanced Options</summary>
            <div class="options">
              <div class="option-group checkbox-number-group">
                <span>SH-aLRT Replicates</span>
                <label class="checkbox-option">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    bind:value={branchSupportReplicates}
                    disabled={state === 'running' || !computeBranchSupport}
                  />
                  <input type="checkbox" bind:checked={computeBranchSupport} disabled={state === 'running'} />
                </label>
              </div>
              <DivergenceQualityFilter
                {divergence}
                enabled={filterDivergentSamples}
                threshold={maxDivergencePercent}
                onEnabledChange={setFilterDivergentSamples}
                onThresholdChange={setMaxDivergencePercent}
                disabled={state === 'running'}
              />
            </div>
          </details>

          {#if state === 'running' || logs.length}
            <div class="log-panel" aria-live="polite">
              <div class="log-title">Run log</div>
              <div class="log-lines" bind:this={logLinesElement}>
                {#if logs.length}
                  {#each logs as line}
                    <div>{line}</div>
                  {/each}
                {:else}
                  <div class="log-muted">Waiting for CMAPLE output.</div>
                {/if}
              </div>
            </div>
          {/if}

          <div class="modal-actions">
            {#if state !== 'running'}
              <button type="button" class="ghost" onclick={openFilePicker}>Choose another</button>
            {/if}
            {#if state === 'running'}
              <span class="run-timer" aria-live="polite">{formatElapsed(elapsedMs)}</span>
            {/if}
            <button type="button" class="primary-button" onclick={runInference} disabled={state !== 'ready'}>Run</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>
