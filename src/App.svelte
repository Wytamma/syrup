<script lang="ts">
  import { afterUpdate, onDestroy, onMount } from 'svelte'
  import AppTopbar from './lib/components/AppTopbar.svelte'
  import SyrupLogo from './lib/components/SyrupLogo.svelte'
  import TreeViewer from './lib/components/TreeViewer.svelte'
  import type { AlignmentStats, CmapleWorkerResponse } from './types/cmaple'

  type AppState = 'idle' | 'preflight' | 'ready' | 'running' | 'done' | 'error'
  type ThemeMode = 'dark' | 'light'

  const THEME_STORAGE_KEY = 'syrup-theme'
  const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'
  const ALIGNMENT_QUERY_PARAM = 'alignment'

  let worker: Worker | null = null
  let state: AppState = 'idle'
  let currentId = ''
  let selectedFile: File | null = null
  let fileName = ''
  let isDragging = false
  let error = ''
  let stats: AlignmentStats | null = null
  let effective: boolean | null = null
  let warnings: string[] = []
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
  let copyFeedbackTimer: number | null = null
  let downloadFeedbackTimer: number | null = null
  let didCopyNewick = false
  let didDownloadNewick = false
  let numThreads = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1))
  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 1)
  let theme: ThemeMode = 'dark'
  let systemThemeMedia: MediaQueryList | null = null

  afterUpdate(() => {
    if (state === 'running' && logs.length !== lastScrolledLogCount && logLinesElement) {
      logLinesElement.scrollTop = logLinesElement.scrollHeight
    }
    lastScrolledLogCount = logs.length
  })

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
        stopTimer()
        state = 'error'
        return
      }

      if (message.type === 'preflight') {
        stats = message.stats
        effective = message.effective
        warnings = message.warnings
        error = ''
        state = 'ready'
        return
      }

      error = ''
      newick = message.newick
      logLikelihood = message.logLikelihood
      effective = message.effective
      warnings = message.warnings
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
    effective = null
    warnings = []
    logs = []
    newick = ''
    logLikelihood = null
    state = 'preflight'

    if (file.size > 75 * 1024 * 1024) {
      logs = [`Large alignment: ${formatFileSize(file.size)}. WebAssembly memory may grow during parsing and inference.`]
    }

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
      error = err instanceof Error ? err.message : 'Could not read the selected file.'
      state = 'error'
    }
  }

  function runInference() {
    if (!currentId || state !== 'ready') return
    error = ''
    logs = []
    startTimer()
    state = 'running'
    getWorker().postMessage({
      type: 'infer',
      id: currentId,
      numThreads,
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

  function openDropzonePicker(event: MouseEvent) {
    const target = event.target as HTMLElement
    if (target.closest('.syrup-tuner') || target.closest('button') || target.closest('input')) return
    dropzoneInput?.click()
  }

  function handleDropzoneKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target as HTMLElement
    if (target.closest('.syrup-tuner')) return
    event.preventDefault()
    dropzoneInput?.click()
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
      <button type="button" class="tree-reset-button" aria-label="New run" title="New run" onclick={clearCurrent}>
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
            <p class="eyebrow">CMAPLE v2 WASM</p>
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
          <div class="loading">Parsing alignment and checking CMAPLE effectiveness.</div>
        {:else if state === 'error'}
          <div class="error" role="alert">{error}</div>
          <div class="modal-actions">
            <label class="button-like">
              Choose another file
              <input type="file" accept=".fa,.fasta,.phy,.phylip,.maple,.txt" onchange={handleInput} />
            </label>
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
                <strong>{effective ? 'Yes' : 'No'}</strong>
              </div>
            </div>
          {/if}

          {#if effective === false}
            <div class="warning" role="alert">
              This data is likely not suitable for analysis with CMAPLE.
            </div>
          {/if}

          {#if warnings.length}
            <div class="warning">{warnings.join(' ')}</div>
          {/if}

          <div class="options">
            <label>
              <span>CMAPLE threads</span>
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

          <div class="log-panel" aria-live="polite">
            <div class="log-title">Run log</div>
            <div class="log-lines" bind:this={logLinesElement}>
              {#if logs.length}
                {#each logs as line}
                  <div>{line}</div>
                {/each}
              {:else}
                <div class="log-muted">
                  {state === 'running' ? 'Waiting for CMAPLE output.' : 'Logs will appear here after Run.'}
                </div>
              {/if}
            </div>
          </div>

          <div class="modal-actions">
            {#if state !== 'running'}
              <button type="button" class="ghost" onclick={clearCurrent}>Choose another</button>
            {/if}
            {#if state === 'running'}
              <span class="run-timer" aria-live="polite">{formatElapsed(elapsedMs)}</span>
            {/if}
            <button type="button" onclick={runInference} disabled={state !== 'ready'}>Run</button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>
