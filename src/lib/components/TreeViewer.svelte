<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { PhylocanvasGL, TreeTypes } from '@phylocanvas/phylocanvas.gl'
  import type { PhylocanvasOptions } from '@phylocanvas/phylocanvas.gl'

  export let newick: string
  export let theme: 'dark' | 'light' = 'dark'
  export let placedSampleNames: string[] = []
  export let showInternalLabels = false
  export let showLeafLabels = true

  let container: HTMLDivElement
  let tree: {
    destroy?: () => void
    setProps?: (options: Partial<PhylocanvasOptions>) => void
    render?: () => void
    deck?: {
      props?: {
        useDevicePixels?: number | boolean
      }
    }
  } | null = null
  function applyContainerSize() {
    if (!container) return

    container.style.width = `${window.innerWidth}px`
    container.style.height = `${window.innerHeight}px`
  }

  function computeCanvasSize() {
    const rect = container.getBoundingClientRect()
    return {
      width: Math.max(1, Math.floor(rect.width || container.clientWidth || 0)),
      height: Math.max(20, Math.floor(rect.height || container.clientHeight || 0)),
    }
  }

  function getThemeOptions(): Pick<PhylocanvasOptions, 'backgroundColour' | 'fillColour' | 'strokeColour' | 'fontColour'> {
    if (theme === 'dark') {
      return {
        backgroundColour: null,
        fillColour: [245, 245, 245, 255],
        strokeColour: [245, 245, 245, 255],
        fontColour: [229, 229, 229, 255],
      }
    }

    return {
      backgroundColour: null,
      fillColour: [34, 34, 34, 255],
      strokeColour: [34, 34, 34, 255],
      fontColour: [34, 34, 34, 255],
    }
  }

  function getAccentColour() {
    if (!container) return theme === 'dark' ? '#ff981f' : '#d87905'
    return getComputedStyle(container).getPropertyValue('--accent').trim() || (theme === 'dark' ? '#ff981f' : '#d87905')
  }

  function getPlacedSampleStyles(): PhylocanvasOptions['styles'] {
    const accent = getAccentColour()
    return Object.fromEntries(
      placedSampleNames.filter(Boolean).map((name) => [
        name,
        {
          fillColour: accent,
          strokeColour: accent,
        },
      ]),
    )
  }

  function getTreeOptions(): PhylocanvasOptions | null {
    if (!container || !newick) return null

    return {
      size: computeCanvasSize(),
      source: newick,
      type: TreeTypes.Rectangular,
      showLabels: true,
      showInternalLabels,
      showLeafLabels,
      interactive: true,
      nodeSize: 10,
      styles: getPlacedSampleStyles(),
      ...getThemeOptions(),
    }
  }

  function ensureTree() {
    if (!container || !newick) return

    const options = getTreeOptions()
    if (!options) return

    if (!tree) {
      tree = new PhylocanvasGL(container, options)
      if (tree.deck?.props) {
        tree.deck.props.useDevicePixels = 2
      }
    }
  }

  function render() {
    ensureTree()
    if (!tree) return

    const options = getTreeOptions()
    if (!options) return

    tree.setProps?.(options)
    tree.render?.()
  }

  function handleResize() {
    if (!container || !tree) return

    applyContainerSize()
    tree.setProps?.({ size: computeCanvasSize() })
    tree.render?.()
  }

  onMount(() => {
    applyContainerSize()
    render()
    window.addEventListener('resize', handleResize)
  })

  $: if (container && newick && theme !== undefined && placedSampleNames !== undefined && showInternalLabels !== undefined && showLeafLabels !== undefined) {
    render()
  }

  onDestroy(() => {
    window.removeEventListener('resize', handleResize)
    tree?.destroy?.()
  })
</script>

<div class="tree-canvas" bind:this={container}></div>
