<script lang="ts">
  import type { BranchSupportMethod } from '../../types/cmaple'

  export let method: BranchSupportMethod = 'sprta'
  export let replicates = 1000
  export let epsilon = 0.1
  export let disabled = false
  export let onMethodChange: (value: BranchSupportMethod) => void = () => {}
  export let onReplicatesChange: (value: number) => void = () => {}
  export let onEpsilonChange: (value: number) => void = () => {}

  function setEnabled(enabled: boolean) {
    onMethodChange(enabled ? 'sprta' : 'none')
  }
</script>

<div class="option-group checkbox-number-group">
  <span>Branch support</span>
  <div class="checkbox-option branch-support-option">
    <div class="branch-support-controls">
      <div class="branch-support-radios" role="radiogroup" aria-label="Branch support method">
        <label>
          <input
            type="radio"
            name="branch-support-method"
            value="sprta"
            checked={method === 'sprta'}
            disabled={disabled || method === 'none'}
            onchange={() => onMethodChange('sprta')}
          />
          <span>SPRTA</span>
        </label>
        <label>
          <input
            type="radio"
            name="branch-support-method"
            value="sh-alrt"
            checked={method === 'sh-alrt'}
            disabled={disabled || method === 'none'}
            onchange={() => onMethodChange('sh-alrt')}
          />
          <span>SH-aLRT</span>
        </label>
      </div>
      {#if method === 'sh-alrt'}
        <div class="branch-support-alrt-options">
          <label>
            <span>Replicates</span>
            <input
              type="number"
              min="1"
              step="1"
              value={replicates}
              aria-label="SH-aLRT replicates"
              disabled={disabled}
              oninput={(event) => onReplicatesChange(Number(event.currentTarget.value))}
            />
          </label>
          <label>
            <span>Epsilon</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={epsilon}
              aria-label="SH-aLRT epsilon"
              disabled={disabled}
              oninput={(event) => onEpsilonChange(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      {/if}
    </div>
    <input
      type="checkbox"
      checked={method !== 'none'}
      disabled={disabled}
      onchange={(event) => setEnabled(event.currentTarget.checked)}
    />
  </div>
</div>
