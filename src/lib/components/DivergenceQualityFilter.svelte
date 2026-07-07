<script lang="ts">
  import { onDestroy, tick } from 'svelte'
  import type { DivergenceSummary } from '../../types/cmaple'

  export let divergence: DivergenceSummary | null = null
  export let enabled = false
  export let threshold = 6.7
  export let disabled = false
  export let onEnabledChange: (enabled: boolean) => void = () => {}
  export let onThresholdChange: (threshold: number) => void = () => {}

  const MARKER_RADIUS = 4.5
  const MARKER_STROKE_WIDTH = 2

  let canvas: HTMLCanvasElement | null = null
  let track: HTMLSpanElement | null = null
  let draftThreshold = threshold
  let isAdjustingThreshold = false
  let drawFrame: number | null = null
  let lastDrawKey = ''

  $: if (!isAdjustingThreshold && threshold !== draftThreshold) draftThreshold = threshold
  $: sliderMax = Math.max(10, Math.ceil(Math.max(divergence?.maxScore ?? 0, draftThreshold)))
  $: thresholdPosition = Math.min(100, Math.max(0, (draftThreshold / sliderMax) * 100))
  $: sampleScores = divergence?.sampleScores ?? []
  $: includedSampleCount = countIncludedSamples(sampleScores, enabled, draftThreshold)
  $: removedSampleCount = Math.max(0, sampleScores.length - includedSampleCount)
  $: scheduleCanvasDraw(
    [
      sampleScores,
      sampleScores.length,
      divergence?.maxScore ?? 0,
      enabled,
      thresholdPosition,
      sliderMax,
      disabled,
    ],
  )

  onDestroy(() => {
    if (drawFrame !== null) cancelAnimationFrame(drawFrame)
  })

  function formatPercent(value: number) {
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`
  }

  function getSliderMax() {
    return sliderMax
  }

  function handleThresholdInput(event: Event) {
    draftThreshold = Number((event.currentTarget as HTMLInputElement).value)
  }

  function handleThresholdChange(event: Event) {
    draftThreshold = Number((event.currentTarget as HTMLInputElement).value)
    onThresholdChange(draftThreshold)
  }

  function handleEnabledChange(event: Event) {
    onEnabledChange((event.currentTarget as HTMLInputElement).checked)
  }

  function updateThresholdFromPointer(event: PointerEvent) {
    if (!track) return draftThreshold

    const rect = track.getBoundingClientRect()
    const position = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const nextThreshold = position * getSliderMax()
    draftThreshold = Math.round(nextThreshold * 10) / 10
    return draftThreshold
  }

  function handleThresholdPointerDown(event: PointerEvent) {
    if (disabled || !enabled) return

    event.preventDefault()
    isAdjustingThreshold = true
    updateThresholdFromPointer(event)

    const handlePointerMove = (moveEvent: PointerEvent) => updateThresholdFromPointer(moveEvent)
    const handlePointerUp = () => {
      isAdjustingThreshold = false
      onThresholdChange(draftThreshold)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  function countIncludedSamples(scores: number[], isEnabled: boolean, currentThreshold: number) {
    if (!isEnabled) return scores.length

    let low = 0
    let high = scores.length

    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (scores[middle] <= currentThreshold) low = middle + 1
      else high = middle
    }

    return low
  }

  function seededUnit(seed: number) {
    const value = Math.sin(seed * 12.9898) * 43758.5453
    return value - Math.floor(value)
  }

  function getMarkerPosition(score: number, scoreIndex: number) {
    const normalizedLeft = Math.min(100, Math.max(0, (score / getSliderMax()) * 100))

    return {
      left: normalizedLeft,
      top: seededUnit(scoreIndex + 101) * 100,
    }
  }

  function drawMarker(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    excluded: boolean,
    colors: { stroke: string; fill: string; excludedStroke: string; excludedFill: string },
  ) {
    context.globalAlpha = excluded ? 0.68 : 0.86
    context.fillStyle = excluded ? colors.excludedFill : colors.fill
    context.strokeStyle = excluded ? colors.excludedStroke : colors.stroke
    context.lineWidth = MARKER_STROKE_WIDTH
    context.beginPath()
    context.arc(x, y, MARKER_RADIUS, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.globalAlpha = 1
  }

  function getCanvasMarkerCoordinate(percent: number, size: number, padding: number) {
    return padding + (percent / 100) * Math.max(0, size - padding * 2)
  }

  function getCanvasMarkerXCoordinate(percent: number, size: number) {
    const rightPadding = 8
    const leftPadding = -1
    return leftPadding + (percent / 100) * Math.max(0, size - rightPadding - leftPadding)
  }

  function getCanvasColor(styles: CSSStyleDeclaration, name: string, fallback: string) {
    return styles.getPropertyValue(name).trim() || fallback
  }

  function drawCanvas() {
    const scores = divergence?.sampleScores ?? []
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    const devicePixelRatio = window.devicePixelRatio || 1
    const width = Math.round(rect.width * devicePixelRatio)
    const height = Math.round(rect.height * devicePixelRatio)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const context = canvas.getContext('2d')
    if (!context) return

    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)
    if (!scores.length) return

    const styles = getComputedStyle(canvas)
    const colors = {
      stroke: getCanvasColor(styles, '--border', '#d8d8d8'),
      fill: getCanvasColor(styles, '--surface-strong', '#1a1a1a'),
      excludedStroke: getCanvasColor(styles, '--subtle', '#9d9d9d'),
      excludedFill: getCanvasColor(styles, '--surface', 'rgb(255 255 255 / 0.03)'),
    }
    const trackRect = track?.getBoundingClientRect()
    const thresholdX = trackRect
      ? trackRect.left - rect.left + (thresholdPosition / 100) * trackRect.width
      : (thresholdPosition / 100) * rect.width

    scores.forEach((score, scoreIndex) => {
      const position = getMarkerPosition(score, scoreIndex)
      const markerX = getCanvasMarkerXCoordinate(position.left, rect.width)
      drawMarker(
        context,
        markerX,
        getCanvasMarkerCoordinate(position.top, rect.height, 5.5),
        enabled && markerX - MARKER_RADIUS - MARKER_STROKE_WIDTH / 2 > thresholdX,
        colors,
      )
    })
  }

  function scheduleCanvasDraw(dependencies: unknown[]) {
    const drawKey = dependencies
      .map((dependency) => {
        if (Array.isArray(dependency)) return `${dependency.length}:${dependency[0] ?? ''}:${dependency.at(-1) ?? ''}`
        return String(dependency)
      })
      .join('|')

    if (drawKey === lastDrawKey) return
    lastDrawKey = drawKey

    if (drawFrame !== null) cancelAnimationFrame(drawFrame)
    drawFrame = requestAnimationFrame(async () => {
      drawFrame = null
      await tick()
      drawCanvas()
    })
  }
</script>

<div class="option-group divergence-option">
  <div class="option-heading">
    <span>Divergence / quality filter</span>
    <strong class:filter-disabled={!enabled}>{formatPercent(draftThreshold)}</strong>
  </div>
  <div class="divergence-control" class:filter-enabled={enabled}>
    <input
      type="range"
      min="0"
      max={sliderMax}
      step="0.1"
      value={draftThreshold}
      oninput={handleThresholdInput}
      onchange={handleThresholdChange}
      disabled={disabled || !enabled}
      aria-label="Maximum divergence or missing data"
    />
    <span class="divergence-hit-target" role="presentation" onpointerdown={handleThresholdPointerDown}></span>
    <input
      type="checkbox"
      checked={enabled}
      onchange={handleEnabledChange}
      disabled={disabled}
      aria-label="Enable divergence and quality filter"
    />
    <span bind:this={track} class="divergence-track" aria-hidden="true">
      <span class="divergence-shade" style:width={enabled ? `${thresholdPosition}%` : '0%'}></span>
      <span
        class="divergence-threshold-line"
        class:visible={enabled}
        style:left={`${thresholdPosition}%`}
      ></span>
      <canvas bind:this={canvas} class="divergence-marker-canvas"></canvas>
    </span>
  </div>
  {#if divergence}
    <div class="divergence-summary" aria-live="polite">
      <span>{includedSampleCount.toLocaleString()} included</span>
      <span>{removedSampleCount.toLocaleString()} removed</span>
    </div>
  {/if}
</div>

<style>
  .option-group {
    display: grid;
    gap: 6px;
  }

  .option-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .option-heading span,
  .divergence-summary span {
    color: var(--subtle);
    font-size: 0.82rem;
  }

  .option-heading strong {
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
  }

  .option-heading strong.filter-disabled {
    opacity: 0.55;
  }

  .divergence-control {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px !important;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    min-width: 0;
  }

  .divergence-control input[type="range"] {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 48px;
    opacity: 0;
    pointer-events: none;
    margin-top: 0px;
  }

  .divergence-control input[type="range"]:disabled {
    cursor: default;
  }

  .divergence-hit-target {
    position: absolute;
    z-index: 5;
    left: 0;
    right: 40px;
    top: 0;
    bottom: 0;
    cursor: pointer;
  }

  .divergence-control:not(.filter-enabled) .divergence-hit-target {
    cursor: default;
  }

  .divergence-control input[type="checkbox"] {
    position: relative;
    z-index: 6;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    justify-self: end;
  }

  .divergence-track {
    position: absolute;
    z-index: 1;
    left: 0;
    right: 40px;
    top: 50%;
    height: 42px;
    border: 1px solid var(--border);
    border-radius: 8px;
    transform: translateY(-50%);
    overflow: hidden;
    background: var(--surface);
  }

  .divergence-control:not(.filter-enabled) .divergence-track {
    opacity: 0.55;
  }

  .divergence-threshold-line {
    position: absolute;
    z-index: 4;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--border);
    transform: translateX(-1px);
    opacity: 0;
  }

  .divergence-threshold-line.visible {
    opacity: 1;
  }

  .divergence-shade {
    position: absolute;
    z-index: 1;
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--shade);
    background-color: color-mix(in srgb, var(--accent) 22%, transparent);
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 8px,
      color-mix(in srgb, var(--accent) 55%, transparent) 8px 10px
    );
    opacity: 0.75;
    pointer-events: none;
  }

  .divergence-marker-canvas {
    position: absolute;
    z-index: 3;
    top: 0;
    right: 0;
    bottom: 0;
    left: -6px;
    width: calc(100% + 6px);
    height: 100%;
    pointer-events: none;
  }

  .divergence-summary {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  .divergence-summary span {
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
</style>
