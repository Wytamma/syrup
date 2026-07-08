<script lang="ts">
  export let fileName = ''
  export let referenceAlignmentFileName = ''
  export let branchLengthsFixed = false
  export let noReroot = false
  export let disabled = false
  export let onFileChange: (file: File | null) => void = () => {}
  export let onReferenceAlignmentFileChange: (file: File | null) => void = () => {}
  export let onBranchLengthsFixedChange: (enabled: boolean) => void = () => {}
  export let onNoRerootChange: (enabled: boolean) => void = () => {}

  let fileInput: HTMLInputElement | null = null
  let referenceAlignmentInput: HTMLInputElement | null = null

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    onFileChange(input.files?.[0] ?? null)
  }

  function clearReferenceTree() {
    if (fileInput) fileInput.value = ''
    onFileChange(null)
  }

  function chooseReferenceTree() {
    fileInput?.click()
  }

  function handleReferenceAlignmentChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    onReferenceAlignmentFileChange(input.files?.[0] ?? null)
  }

  function clearReferenceAlignment() {
    if (referenceAlignmentInput) referenceAlignmentInput.value = ''
    onReferenceAlignmentFileChange(null)
  }

  function chooseReferenceAlignment() {
    referenceAlignmentInput?.click()
  }
</script>

<div class="option-group reference-tree-group">
  <div class="option-heading">
    <span>Reference tree</span>
  </div>
  <div class="reference-tree-file-row">
    <div class="reference-tree-upload" aria-live="polite">
      <span>{fileName || 'Select tree file'}</span>
    </div>
    <input
      bind:this={fileInput}
      class="reference-tree-native-input"
      type="file"
      accept=".nwk,.newick,.tree,.tre,.nex,.nexus,text/plain"
      disabled={disabled}
      onchange={handleFileChange}
      aria-label="Select reference tree file"
    />
    {#if !fileName}
      <button type="button" class="ghost reference-tree-add" disabled={disabled} onclick={chooseReferenceTree}>
        Add tree
      </button>
    {/if}
    {#if fileName}
      <button type="button" class="ghost reference-tree-clear" disabled={disabled} onclick={clearReferenceTree}>
        Clear
      </button>
    {/if}
  </div>
  {#if fileName}
    <div class="option-heading">
      <span>Reference alignment</span>
    </div>
    <div class="reference-tree-file-row">
      <div class="reference-tree-upload" aria-live="polite">
        <span>{referenceAlignmentFileName || 'Select alignment file'}</span>
      </div>
      <input
        bind:this={referenceAlignmentInput}
        class="reference-tree-native-input"
        type="file"
        accept=".fa,.fasta,.fas,.fna,.faa,.phy,.phylip,.maple,text/plain"
        disabled={disabled}
        onchange={handleReferenceAlignmentChange}
        aria-label="Select reference alignment file"
      />
      {#if !referenceAlignmentFileName}
        <button type="button" class="ghost reference-tree-add" disabled={disabled} onclick={chooseReferenceAlignment}>
          Add alignment
        </button>
      {/if}
      {#if referenceAlignmentFileName}
        <button type="button" class="ghost reference-tree-clear" disabled={disabled} onclick={clearReferenceAlignment}>
          Clear
        </button>
      {/if}
    </div>
    <div class="reference-tree-flags">
      <label class="checkbox-option reference-tree-no-reroot">
        <span>No reroot</span>
        <input
          type="checkbox"
          checked={noReroot}
          disabled={disabled}
          onchange={(event) => onNoRerootChange(event.currentTarget.checked)}
          aria-label="Do not reroot the reference tree"
        />
      </label>
      <label class="checkbox-option reference-tree-blfix">
        <span>Branch lengths fixed</span>
        <input
          type="checkbox"
          checked={branchLengthsFixed}
          disabled={disabled}
          onchange={(event) => onBranchLengthsFixedChange(event.currentTarget.checked)}
          aria-label="Keep reference tree branch lengths fixed"
        />
      </label>
    </div>
  {/if}
</div>
