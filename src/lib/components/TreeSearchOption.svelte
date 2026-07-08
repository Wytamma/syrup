<script lang="ts">
  import type { TreeSearchType } from '../../types/cmaple'

  export let value: TreeSearchType = 'normal'
  export let disabled = false
  export let onChange: (value: TreeSearchType) => void = () => {}
</script>

<div class="option-group tree-search-group">
  <div class="option-heading">
    <span>Tree search type</span>
  </div>
  <label class="number-option tree-search-option">
    <select
      value={value}
      disabled={disabled}
      onchange={(event) => onChange(event.currentTarget.value as TreeSearchType)}
      aria-label="Tree search type"
    >
      <option value="fast">FAST</option>
      <option value="normal">NORMAL</option>
      <option value="exhaustive">EXHAUSTIVE</option>
    </select>
  </label>
</div>
