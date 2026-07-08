<script lang="ts">
  export let fileName = ''
  export let startingAlignmentFileName = ''
  export let branchLengthsFixed = false
  export let noReroot = false
  export let disabled = false
  export let onFileChange: (file: File | null) => void = () => {}
  export let onStartingAlignmentFileChange: (file: File | null) => void = () => {}
  export let onBranchLengthsFixedChange: (enabled: boolean) => void = () => {}
  export let onNoRerootChange: (enabled: boolean) => void = () => {}

  let fileInput: HTMLInputElement | null = null
  let startingAlignmentInput: HTMLInputElement | null = null

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    onFileChange(input.files?.[0] ?? null)
  }

  function clearStartingTree() {
    if (fileInput) fileInput.value = ''
    onFileChange(null)
  }

  function chooseStartingTree() {
    fileInput?.click()
  }

  function handleStartingAlignmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    onStartingAlignmentFileChange(input.files?.[0] ?? null)
  }

  function clearStartingAlignment() {
    if (startingAlignmentInput) startingAlignmentInput.value = ''
    onStartingAlignmentFileChange(null)
  }

  function chooseStartingAlignment() {
    startingAlignmentInput?.click()
  }
</script>

<div class="option-group starting-tree-group">
  <div class="option-heading">
    <span>Starting tree</span>
  </div>
  <div class="starting-tree-file-row">
    <div class="starting-tree-upload" aria-live="polite">
      <span>{fileName || 'Select tree file'}</span>
    </div>
    <input
      bind:this={fileInput}
      class="starting-tree-native-input"
      type="file"
      accept=".nwk,.newick,.tree,.tre,.nex,.nexus,text/plain"
      disabled={disabled}
      onchange={handleFileChange}
      aria-label="Select starting tree file"
    />
    {#if !fileName}
      <button type="button" class="ghost starting-tree-add" disabled={disabled} onclick={chooseStartingTree}>
        Add tree
      </button>
    {/if}
    {#if fileName}
      <button type="button" class="ghost starting-tree-clear" disabled={disabled} onclick={clearStartingTree}>
        Clear
      </button>
    {/if}
  </div>
  {#if fileName}
    <div class="option-heading">
      <span>Starting alignment</span>
    </div>
    <div class="starting-tree-file-row">
      <div class="starting-tree-upload" aria-live="polite">
        <span>{startingAlignmentFileName || 'Select alignment file'}</span>
      </div>
      <input
        bind:this={startingAlignmentInput}
        class="starting-tree-native-input"
        type="file"
        accept=".fa,.fasta,.fas,.fna,.faa,.phy,.phylip,.maple,text/plain"
        disabled={disabled}
        onchange={handleStartingAlignmentChange}
        aria-label="Select starting alignment file"
      />
      {#if !startingAlignmentFileName}
        <button type="button" class="ghost starting-tree-add" disabled={disabled} onclick={chooseStartingAlignment}>
          Add alignment
        </button>
      {/if}
      {#if startingAlignmentFileName}
        <button type="button" class="ghost starting-tree-clear" disabled={disabled} onclick={clearStartingAlignment}>
          Clear
        </button>
      {/if}
    </div>
    <div class="starting-tree-flags">
      <label class="checkbox-option starting-tree-no-reroot">
        <span>No reroot</span>
        <input
          type="checkbox"
          checked={noReroot}
          disabled={disabled}
          onchange={(event) => onNoRerootChange(event.currentTarget.checked)}
          aria-label="Do not reroot the starting tree"
        />
      </label>
      <label class="checkbox-option starting-tree-blfix">
        <span>Branch lengths fixed</span>
        <input
          type="checkbox"
          checked={branchLengthsFixed}
          disabled={disabled}
          onchange={(event) => onBranchLengthsFixedChange(event.currentTarget.checked)}
          aria-label="Keep starting tree branch lengths fixed"
        />
      </label>
    </div>
  {/if}
</div>
