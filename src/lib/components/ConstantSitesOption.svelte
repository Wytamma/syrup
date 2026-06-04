<script lang="ts">
  import { formatConstantSites, getTotalConstantSites } from '../cmaple-settings'
  import type { ConstantSiteCounts } from '../../types/cmaple'

  export let text = ''
  export let constantSites: ConstantSiteCounts = { a: 0, c: 0, g: 0, t: 0 }
  export let activeConstantSites: ConstantSiteCounts = { a: 0, c: 0, g: 0, t: 0 }
  export let adjustedSequenceLength = 0
  export let hasStats = false
  export let enabled = false
  export let disabled = false
  export let onTextChange: (value: string, shouldRequestWarningSummary?: boolean) => void = () => {}
  export let onTextCommit: (value: string) => void = () => {}
  export let onFormattedTextChange: (value: string) => void = () => {}
  export let onEnabledChange: (enabled: boolean) => void = () => {}
</script>

<div class="option-group constant-sites-group">
  <div class="option-heading">
    <span>Constant sites</span>
    {#if hasStats && getTotalConstantSites(activeConstantSites) > 0}
      <span class="option-note">Adjusted length: {adjustedSequenceLength.toLocaleString()}</span>
    {/if}
  </div>
  <label class="checkbox-option constant-sites-option">
    <input
      class="constant-sites-input"
      type="text"
      inputmode="numeric"
      value={text}
      placeholder="A, C, G, T counts"
      aria-label="Constant site counts in A, C, G, T order"
      disabled={disabled}
      oninput={(event) => onTextChange(event.currentTarget.value, false)}
      onchange={(event) => onTextCommit(event.currentTarget.value)}
      onblur={(event) => {
        onTextCommit(event.currentTarget.value)
        onFormattedTextChange(formatConstantSites(constantSites))
      }}
    />
    <input
      type="checkbox"
      checked={enabled}
      onchange={(event) => onEnabledChange(event.currentTarget.checked)}
      disabled={disabled}
      aria-label="Enable constant site counts"
    />
  </label>
</div>
