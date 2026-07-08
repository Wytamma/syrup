<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import AppTopbar from './lib/components/AppTopbar.svelte'
  import LandingDropzone from './lib/components/LandingDropzone.svelte'
  import RunModal from './lib/components/RunModal.svelte'
  import TreeResultView from './lib/components/TreeResultView.svelte'
  import { createCmapleApp } from './lib/state/cmaple-app.svelte'
  import { createThemeController } from './lib/state/theme.svelte'

  const app = createCmapleApp()
  const theme = createThemeController()

  let landingDropzone: { openFilePicker: () => void } | null = null

  function openFilePicker() {
    landingDropzone?.openFilePicker()
  }

  function getDivergence() {
    return app.divergence
  }

  onMount(() => {
    theme.mount()
    app.loadAlignmentFromQueryParam()
  })

  onDestroy(() => {
    theme.destroy()
    app.destroy()
  })
</script>

<main class:tree-mode={app.state === 'done'}>
  {#if app.state === 'done'}
    <TreeResultView {app} theme={theme.theme} onToggleTheme={theme.toggleTheme} />
  {:else}
    <div class="app-shell">
      <section class="app-frame" aria-label="Syrup landing page">
        <AppTopbar theme={theme.theme} onToggleTheme={theme.toggleTheme} />
        <LandingDropzone bind:this={landingDropzone} state={app.state} onLoadFile={app.loadFile} />
      </section>
    </div>
  {/if}

  {#if app.state === 'preflight' || app.state === 'ready' || app.state === 'running' || app.state === 'error'}
    <RunModal
      state={app.state}
      selectedFile={app.selectedFile}
      fileName={app.fileName}
      error={app.error}
      stats={app.stats}
      warningSummary={app.warningSummary}
      {getDivergence}
      effectiveStatus={app.effectiveStatus}
      displayedWarnings={app.displayedWarnings}
      logs={app.logs}
      elapsedMs={app.elapsedMs}
      isExportingMaple={app.isExportingMaple}
      numThreads={app.numThreads}
      maxThreads={app.maxThreads}
      substitutionModel={app.substitutionModel}
      branchSupportMethod={app.branchSupportMethod}
      branchSupportReplicates={app.branchSupportReplicates}
      branchSupportEpsilon={app.branchSupportEpsilon}
      filterDivergentSamples={app.filterDivergentSamples}
      maxDivergencePercent={app.maxDivergencePercent}
      useConstantSites={app.useConstantSites}
      constantSites={app.constantSites}
      constantSitesText={app.constantSitesText}
      startingTreeFileName={app.startingTreeFileName}
      startingAlignmentFileName={app.startingAlignmentFileName}
      branchLengthsFixed={app.branchLengthsFixed}
      noReroot={app.noReroot}
      treeSearchType={app.treeSearchType}
      estimateMat={app.estimateMat}
      activeConstantSites={app.activeConstantSites}
      adjustedSequenceLength={app.adjustedSequenceLength}
      crossOriginIsolated={globalThis.crossOriginIsolated}
      onChooseAnother={openFilePicker}
      onClearCurrent={app.clearCurrent}
      onDownloadMaple={app.downloadMaple}
      onRunInference={app.runInference}
      onNumThreadsChange={app.setNumThreads}
      onSubstitutionModelChange={app.setSubstitutionModel}
      onBranchSupportMethodChange={app.setBranchSupportMethod}
      onBranchSupportReplicatesChange={app.setBranchSupportReplicates}
      onBranchSupportEpsilonChange={app.setBranchSupportEpsilon}
      onConstantSiteTextChange={app.setConstantSiteCountsFromText}
      onConstantSiteTextCommit={app.setConstantSiteCountsFromText}
      onFormattedConstantSiteTextChange={app.setConstantSitesText}
      onUseConstantSitesChange={app.setUseConstantSites}
      onStartingTreeFileChange={app.setStartingTreeFile}
      onStartingAlignmentFileChange={app.setStartingAlignmentFile}
      onBranchLengthsFixedChange={app.setBranchLengthsFixed}
      onNoRerootChange={app.setNoReroot}
      onTreeSearchTypeChange={app.setTreeSearchType}
      onEstimateMatChange={app.setEstimateMat}
      onFilterDivergentSamplesChange={app.setFilterDivergentSamples}
      onMaxDivergencePercentChange={app.setMaxDivergencePercent}
    />
  {/if}
</main>
