<script lang="ts">
  export let value = 1
  export let max = 1
  export let disabled = false
  export let onChange: (value: number) => void = () => {}
</script>

<div class="option-group">
  <span>Threads</span>
  <label class="thread-option">
    <input
      type="range"
      min="1"
      {max}
      value={value}
      disabled={disabled}
      oninput={(event) => onChange(Number(event.currentTarget.value))}
    />
    <strong>{value}</strong>
  </label>
</div>
