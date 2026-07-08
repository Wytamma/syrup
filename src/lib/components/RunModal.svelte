<script lang="ts">
  import { afterUpdate } from 'svelte'
  import { formatElapsed, formatFileSize } from '../cmaple-settings'
  import type {
    AlignmentStats,
    AlignmentWarningSummary,
    BranchSupportMethod,
    ConstantSiteCounts,
    DivergenceSummary,
    SubstitutionModel,
    TreeSearchType,
  } from '../../types/cmaple'
  import type { AppState } from '../state/cmaple-app.svelte'
  import BranchSupportOption from './BranchSupportOption.svelte'
  import ConstantSitesOption from './ConstantSitesOption.svelte'
  import DivergenceQualityFilter from './DivergenceQualityFilter.svelte'
  import ReferenceTreeOption from './ReferenceTreeOption.svelte'
  import SubstitutionModelOption from './SubstitutionModelOption.svelte'
  import TreeSearchOption from './TreeSearchOption.svelte'

  export let state: AppState
  export let selectedFile: File | null = null
  export let fileName = ''
  export let error = ''
  export let stats: AlignmentStats | null = null
  export let warningSummary: AlignmentWarningSummary | null = null
  export let getDivergence: () => DivergenceSummary | null = () => null
  export let effectiveStatus: boolean | null = null
  export let displayedWarnings: string[] = []
  export let logs: string[] = []
  export let elapsedMs = 0
  export let isExportingMaple = false
  export let numThreads = 1
  export let maxThreads = 1
  export let substitutionModel: SubstitutionModel = 'GTR'
  export let branchSupportMethod: BranchSupportMethod = 'sprta'
  export let branchSupportReplicates = 1000
  export let branchSupportEpsilon = 0.1
  export let filterDivergentSamples = false
  export let maxDivergencePercent = 6.7
  export let useConstantSites = false
  export let constantSites: ConstantSiteCounts = { a: 0, c: 0, g: 0, t: 0 }
  export let constantSitesText = ''
  export let referenceTreeFileName = ''
  export let branchLengthsFixed = false
  export let noReroot = false
  export let treeSearchType: TreeSearchType = 'normal'
  export let activeConstantSites: ConstantSiteCounts = { a: 0, c: 0, g: 0, t: 0 }
  export let adjustedSequenceLength = 0
  export let crossOriginIsolated = false
  export let onChooseAnother: () => void = () => {}
  export let onClearCurrent: () => void = () => {}
  export let onDownloadMaple: () => void = () => {}
  export let onRunInference: () => void = () => {}
  export let onNumThreadsChange: (value: number) => void = () => {}
  export let onSubstitutionModelChange: (value: SubstitutionModel) => void = () => {}
  export let onBranchSupportMethodChange: (value: BranchSupportMethod) => void = () => {}
  export let onBranchSupportReplicatesChange: (value: number) => void = () => {}
  export let onBranchSupportEpsilonChange: (value: number) => void = () => {}
  export let onConstantSiteTextChange: (value: string, shouldRequestWarningSummary?: boolean) => void = () => {}
  export let onConstantSiteTextCommit: (value: string) => void = () => {}
  export let onFormattedConstantSiteTextChange: (value: string) => void = () => {}
  export let onUseConstantSitesChange: (enabled: boolean) => void = () => {}
  export let onReferenceTreeFileChange: (file: File | null) => void = () => {}
  export let onBranchLengthsFixedChange: (enabled: boolean) => void = () => {}
  export let onNoRerootChange: (enabled: boolean) => void = () => {}
  export let onTreeSearchTypeChange: (value: TreeSearchType) => void = () => {}
  export let onFilterDivergentSamplesChange: (enabled: boolean) => void = () => {}
  export let onMaxDivergencePercentChange: (value: number) => void = () => {}

  let logLinesElement: HTMLDivElement | null = null
  let lastScrolledLogCount = 0
  let advancedOptionsElement: HTMLDetailsElement | null = null
  let advancedOptionsOpen = false

  afterUpdate(() => {
    if (state === 'running' && logs.length !== lastScrolledLogCount && logLinesElement) {
      logLinesElement.scrollTop = logLinesElement.scrollHeight
    }
    lastScrolledLogCount = logs.length
  })

  function runInference() {
    advancedOptionsOpen = false
    if (advancedOptionsElement) advancedOptionsElement.open = false
    onRunInference()
  }
</script>

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
        <button type="button" class="ghost" onclick={onClearCurrent}>Close</button>
      {/if}
    </div>

    <div class="file-line">
      <div class="file-details">
        <strong>{fileName}</strong>
        {#if state !== 'preflight' && state !== 'running'}
          <a
            href="/"
            class="text-link"
            aria-disabled={isExportingMaple}
            onclick={(event) => {
              event.preventDefault()
              if (!isExportingMaple) onDownloadMaple()
            }}
          >
            {isExportingMaple ? 'Preparing MAPLE...' : 'Download MAPLE format'}
          </a>
        {/if}
      </div>
      {#if selectedFile}
        <span class="file-size">{formatFileSize(selectedFile.size)}</span>
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
        <button type="button" onclick={onChooseAnother}>Choose another file</button>
      </div>
    {:else}
      {#if stats}
        <div class="stats-grid">
          <div>
            <span>Sequences</span>
            <strong>{(warningSummary?.sequenceCount ?? stats.sequenceCount).toLocaleString()}</strong>
          </div>
          <div>
            <span>Sequence length</span>
            <strong>{stats.sequenceLength.toLocaleString()}</strong>
          </div>
          <div>
            <span>Variable columns</span>
            <strong>{(warningSummary?.variableColumns ?? 0).toLocaleString()}</strong>
          </div>
          <div>
            <span>CMAPLE effective</span>
            <strong>{effectiveStatus ? 'Yes' : 'No'}</strong>
          </div>
        </div>
      {/if}

      {#if error}
        <div class="error" role="alert">{error}</div>
      {/if}

      {#if effectiveStatus === false}
        <div class="warning" role="alert">
          This data is likely not suitable for analysis with CMAPLE.
        </div>
      {/if}

      {#if displayedWarnings.length}
        <div class="warning">{displayedWarnings.join(' ')}</div>
      {/if}

      <div class="options run-options">
        <SubstitutionModelOption
          value={substitutionModel}
          sequenceType={stats?.sequenceType ?? 'dna'}
          disabled={state === 'running'}
          onChange={onSubstitutionModelChange}
        />
        <BranchSupportOption
          method={branchSupportMethod}
          replicates={branchSupportReplicates}
          epsilon={branchSupportEpsilon}
          threads={numThreads}
          {maxThreads}
          disabled={state === 'running'}
          threadsDisabled={state === 'running' || !crossOriginIsolated}
          onMethodChange={onBranchSupportMethodChange}
          onReplicatesChange={onBranchSupportReplicatesChange}
          onEpsilonChange={onBranchSupportEpsilonChange}
          onThreadsChange={onNumThreadsChange}
        />
      </div>

      <details bind:this={advancedOptionsElement} bind:open={advancedOptionsOpen} class="advanced-options">
        <summary>Advanced Options</summary>
        {#if advancedOptionsOpen}
          <div class="options">
            <ReferenceTreeOption
              fileName={referenceTreeFileName}
              {branchLengthsFixed}
              {noReroot}
              disabled={state === 'running'}
              onFileChange={onReferenceTreeFileChange}
              onBranchLengthsFixedChange={onBranchLengthsFixedChange}
              onNoRerootChange={onNoRerootChange}
            />
            <TreeSearchOption
              value={treeSearchType}
              disabled={state === 'running'}
              onChange={onTreeSearchTypeChange}
            />
            <ConstantSitesOption
              text={constantSitesText}
              {constantSites}
              {activeConstantSites}
              {adjustedSequenceLength}
              hasStats={!!stats}
              enabled={(stats?.sequenceType ?? 'dna') === 'dna' && useConstantSites}
              disabled={state === 'running' || stats?.sequenceType === 'protein'}
              onTextChange={onConstantSiteTextChange}
              onTextCommit={onConstantSiteTextCommit}
              onFormattedTextChange={onFormattedConstantSiteTextChange}
              onEnabledChange={onUseConstantSitesChange}
            />
            <DivergenceQualityFilter
              divergence={getDivergence()}
              enabled={filterDivergentSamples}
              threshold={maxDivergencePercent}
              onEnabledChange={onFilterDivergentSamplesChange}
              onThresholdChange={onMaxDivergencePercentChange}
              disabled={state === 'running'}
            />
          </div>
        {/if}
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
          <button type="button" class="ghost" onclick={onChooseAnother}>Choose another</button>
        {/if}
        {#if state === 'running'}
          <span class="run-timer" aria-live="polite">{formatElapsed(elapsedMs)}</span>
        {/if}
        <button type="button" class="primary-button" onclick={runInference} disabled={state !== 'ready'}>Run</button>
      </div>
    {/if}
  </div>
</div>
