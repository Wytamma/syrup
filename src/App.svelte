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
    <RunModal {app} crossOriginIsolated={globalThis.crossOriginIsolated} onChooseAnother={openFilePicker} />
  {/if}
</main>
