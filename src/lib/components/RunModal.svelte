<script lang="ts">
  import { afterUpdate } from 'svelte'
  import { formatElapsed, formatFileSize } from '../cmaple-settings'
  import type { CmapleAppController } from '../state/cmaple-app.svelte'
  import BranchSupportOption from './BranchSupportOption.svelte'
  import ConstantSitesOption from './ConstantSitesOption.svelte'
  import DivergenceQualityFilter from './DivergenceQualityFilter.svelte'
  import ThreadOption from './ThreadOption.svelte'

  export let app: CmapleAppController
  export let crossOriginIsolated = false
  export let onChooseAnother: () => void = () => {}

  let logLinesElement: HTMLDivElement | null = null
  let lastScrolledLogCount = 0
  let advancedOptionsElement: HTMLDetailsElement | null = null

  afterUpdate(() => {
    if (app.state === 'running' && app.logs.length !== lastScrolledLogCount && logLinesElement) {
      logLinesElement.scrollTop = logLinesElement.scrollHeight
    }
    lastScrolledLogCount = app.logs.length
  })

  function runInference() {
    if (advancedOptionsElement) advancedOptionsElement.open = false
    app.runInference()
  }
</script>

<div class="modal-backdrop" role="presentation">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-header">
      <div>
        <p class="eyebrow">SYRUP (CMAPLE in the browser)</p>
        <h1 id="modal-title">
          {app.state === 'preflight' ? 'Analyzing alignment' : app.state === 'running' ? 'Running analysis' : 'Alignment ready'}
        </h1>
      </div>
      {#if app.state !== 'running'}
        <button type="button" class="ghost" onclick={app.clearCurrent}>Close</button>
      {/if}
    </div>

    <div class="file-line">
      <strong>{app.fileName}</strong>
      {#if app.selectedFile}
        <span>{formatFileSize(app.selectedFile.size)}</span>
      {/if}
    </div>

    {#if app.state === 'preflight'}
      <div class="loading">
        <span>Parsing alignment and checking CMAPLE effectiveness.</span>
        <strong aria-live="polite">{formatElapsed(app.elapsedMs)}</strong>
      </div>
    {:else if app.state === 'error'}
      <div class="error" role="alert">{app.error}</div>
      <div class="modal-actions">
        <button type="button" onclick={onChooseAnother}>Choose another file</button>
      </div>
    {:else}
      {#if app.stats}
        <div class="stats-grid">
          <div>
            <span>Format</span>
            <strong>{app.stats.format.toUpperCase()}</strong>
          </div>
          <div>
            <span>Sequences</span>
            <strong>{app.stats.sequenceCount.toLocaleString()}</strong>
          </div>
          <div>
            <span>Sequence length</span>
            <strong>{app.stats.sequenceLength.toLocaleString()}</strong>
          </div>
          <div>
            <span>CMAPLE effective</span>
            <strong>{app.effectiveStatus ? 'Yes' : 'No'}</strong>
          </div>
        </div>
      {/if}

      {#if app.error}
        <div class="error" role="alert">{app.error}</div>
      {/if}

      {#if app.effectiveStatus === false}
        <div class="warning" role="alert">
          This data is likely not suitable for analysis with CMAPLE.
        </div>
      {/if}

      {#if app.displayedWarnings.length}
        <div class="warning">{app.displayedWarnings.join(' ')}</div>
      {/if}

      <div class="options">
        <ThreadOption
          value={app.numThreads}
          max={app.maxThreads}
          disabled={app.state === 'running' || !crossOriginIsolated}
          onChange={(value) => (app.numThreads = value)}
        />
      </div>

      <details bind:this={advancedOptionsElement} class="advanced-options">
        <summary>Advanced Options</summary>
        <div class="options">
          <BranchSupportOption
            replicates={app.branchSupportReplicates}
            enabled={app.computeBranchSupport}
            disabled={app.state === 'running'}
            onReplicatesChange={(value) => (app.branchSupportReplicates = value)}
            onEnabledChange={(value) => (app.computeBranchSupport = value)}
          />
          <ConstantSitesOption
            text={app.constantSitesText}
            constantSites={app.constantSites}
            activeConstantSites={app.activeConstantSites}
            adjustedSequenceLength={app.adjustedSequenceLength}
            hasStats={!!app.stats}
            enabled={app.useConstantSites}
            disabled={app.state === 'running'}
            onTextChange={app.setConstantSiteCountsFromText}
            onTextCommit={(value) => app.setConstantSiteCountsFromText(value)}
            onFormattedTextChange={(value) => (app.constantSitesText = value)}
            onEnabledChange={app.setUseConstantSites}
          />
          <DivergenceQualityFilter
            divergence={app.divergence}
            enabled={app.filterDivergentSamples}
            threshold={app.maxDivergencePercent}
            onEnabledChange={app.setFilterDivergentSamples}
            onThresholdChange={app.setMaxDivergencePercent}
            disabled={app.state === 'running'}
          />
        </div>
      </details>

      {#if app.state === 'running' || app.logs.length}
        <div class="log-panel" aria-live="polite">
          <div class="log-title">Run log</div>
          <div class="log-lines" bind:this={logLinesElement}>
            {#if app.logs.length}
              {#each app.logs as line}
                <div>{line}</div>
              {/each}
            {:else}
              <div class="log-muted">Waiting for CMAPLE output.</div>
            {/if}
          </div>
        </div>
      {/if}

      <div class="modal-actions">
        {#if app.state !== 'running'}
          <button type="button" class="ghost" onclick={onChooseAnother}>Choose another</button>
        {/if}
        {#if app.state === 'running'}
          <span class="run-timer" aria-live="polite">{formatElapsed(app.elapsedMs)}</span>
        {/if}
        <button type="button" class="primary-button" onclick={runInference} disabled={app.state !== 'ready'}>Run</button>
      </div>
    {/if}
  </div>
</div>
