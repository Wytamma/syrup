<script lang="ts">
  export let replicates = 1000
  export let enabled = true
  export let disabled = false
  export let onReplicatesChange: (value: number) => void = () => {}
  export let onEnabledChange: (value: boolean) => void = () => {}
</script>

<div class="option-group checkbox-number-group">
  <span>SH-aLRT Replicates</span>
  <label class="checkbox-option">
    <input
      type="number"
      min="1"
      step="1"
      value={replicates}
      disabled={disabled || !enabled}
      oninput={(event) => onReplicatesChange(Number(event.currentTarget.value))}
    />
    <input
      type="checkbox"
      checked={enabled}
      disabled={disabled}
      onchange={(event) => onEnabledChange(event.currentTarget.checked)}
    />
  </label>
</div>
