<script lang="ts">
  import type { SubstitutionModel } from '../../types/cmaple'

  export let value: SubstitutionModel = 'GTR'
  export let disabled = false
  export let onChange: (value: SubstitutionModel) => void = () => {}
</script>

<div class="option-group substitution-model-group">
  <div class="option-heading">
    <span>Substitution model</span>
  </div>
  <label class="number-option substitution-model-option">
    <select
      value={value}
      disabled={disabled}
      onchange={(event) => onChange(event.currentTarget.value as SubstitutionModel)}
      aria-label="Substitution model"
    >
      <option value="GTR">GTR</option>
      <option value="JC">JC</option>
      <option value="UNREST">UNREST</option>
    </select>
  </label>
</div>
