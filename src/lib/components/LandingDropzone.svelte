<script lang="ts">
  import SyrupLogo from './SyrupLogo.svelte'
  import type { AppState } from '../state/cmaple-app.svelte'

  export let state: AppState = 'idle'
  export let onLoadFile: (file: File) => void | Promise<void> = () => {}

  let isDragging = false
  let dropzoneInput: HTMLInputElement | null = null

  export function openFilePicker() {
    dropzoneInput?.click()
  }

  function handleInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file) void onLoadFile(file)
    input.value = ''
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    isDragging = false
    const file = event.dataTransfer?.files?.[0]
    if (file) void onLoadFile(file)
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
</script>

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
  <input bind:this={dropzoneInput} type="file" accept=".fa,.fasta,.fna,.phy,.phylip,.maple,.txt" onchange={handleInput} />
  <SyrupLogo paused={state !== 'idle'} />

  <div class="drop-content">
    <span class="drop-kicker">Pandemic scale phylogenetics in your browser</span>
    <span class="drop-title">Add Alignment</span>
    <span class="drop-copy">FASTA, PHYLIP, or MAPLE text files</span>
  </div>

  <span class="drop-hint">Your data never leaves your computer</span>
</div>
