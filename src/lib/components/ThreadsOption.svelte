<script lang="ts">
  export let threads = 1
  export let maxThreads = 1
  export let disabled = false
  export let onThreadsChange: (value: number) => void = () => {}
</script>

<div class="option-group thread-option">
  <span>Threads</span>
  <div class="branch-support-thread-control">
    <input
      aria-label="Threads"
      type="range"
      min="1"
      max={maxThreads}
      value={threads}
      {disabled}
      oninput={(event) => onThreadsChange(Number(event.currentTarget.value))}
    />
    <strong>{threads}</strong>
  </div>
</div>
