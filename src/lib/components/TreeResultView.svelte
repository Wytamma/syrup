<script lang="ts">
  import AppTopbar from './AppTopbar.svelte'
  import TreeViewer from './TreeViewer.svelte'
  import type { CmapleAppController } from '../state/cmaple-app.svelte'
  import type { ThemeMode } from '../state/theme.svelte'

  export let app: CmapleAppController
  export let theme: ThemeMode = 'dark'
  export let onToggleTheme: () => void = () => {}

  $: placedSampleNames = app.startingTreeText && app.startingAlignmentText ? (app.stats?.sampleNames ?? []) : []
</script>

<AppTopbar {theme} fixed={true} onToggleTheme={onToggleTheme} />

<TreeViewer
  newick={app.newick}
  {theme}
  {placedSampleNames}
  showInternalLabels={app.showInternalLabels}
  showLeafLabels={app.showLeafLabels}
/>
<div class="tree-dock">
  <div class="tree-toolbar">
    <div>
      <strong>{app.fileName}</strong>
      <span>{app.logLikelihood === null ? '' : `Log-likelihood ${Math.round(app.logLikelihood)}`}</span>
    </div>
    <div class="tree-actions">
      <button
        type="button"
        class="icon-button"
        class:active={app.showInternalLabels}
        aria-label={app.showInternalLabels ? 'Hide internal labels' : 'Show internal labels'}
        aria-pressed={app.showInternalLabels}
        title={app.showInternalLabels ? 'Hide internal labels' : 'Show internal labels'}
        onclick={app.toggleInternalLabels}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
          <path d="M6 6h.008v.008H6V6Z" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-button"
        class:active={app.showLeafLabels}
        aria-label={app.showLeafLabels ? 'Hide leaf labels' : 'Show leaf labels'}
        aria-pressed={app.showLeafLabels}
        title={app.showLeafLabels ? 'Hide leaf labels' : 'Show leaf labels'}
        onclick={app.toggleLeafLabels}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.75 6.75h16.5M3.75 12H12m-8.25 5.25h16.5" />
        </svg>
      </button>
      <button
        type="button"
        class="icon-button"
        class:success={app.didCopyNewick}
        aria-label={app.didCopyNewick ? 'Copied Newick' : 'Copy Newick'}
        title={app.didCopyNewick ? 'Copied Newick' : 'Copy Newick'}
        onclick={app.copyNewick}
      >
        {#if app.didCopyNewick}
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
        class:success={app.didDownloadNewick}
        aria-label={app.didDownloadNewick ? 'Downloaded tree' : 'Download tree'}
        title={app.didDownloadNewick ? 'Downloaded tree' : 'Download tree'}
        onclick={app.downloadNewick}
      >
        {#if app.didDownloadNewick}
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
  <button type="button" class="tree-reset-button" aria-label="Modify run" title="Modify run" onclick={app.returnToRunSettings}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  </button>
</div>
