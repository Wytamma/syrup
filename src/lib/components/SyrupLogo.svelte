<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import * as THREE from 'three'
  import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'

  export let paused = false

  type Target = {
    x: number
    y: number
    seed: number
  }

  type LetterField = {
    centerX: number
    scaleX: number
    targets: Target[]
  }

  type LogoField = {
    centerX: number
    halfWidth: number
    targets: Target[]
  }

  let host: HTMLDivElement
  let importInput: HTMLInputElement | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let resizeObserver: ResizeObserver | null = null
  let animationFrame = 0
  let cleanup: (() => void) | null = null
  let pauseAnimation: (() => void) | null = null
  let resumeAnimation: (() => void) | null = null
  let showControls = false

  const SIM = {
    mask: {
      text: 'SYRUP',
      canvasWidth: 1200,
      canvasHeight: 380,
      alphaThreshold: 80,
      worldHeight: 1.95,
      jitter: 0.018,
    },
    camera: {
      halfHeight: 1.45,
      halfWidthByAspect: 2.25,
    },
    pointer: {
      offscreen: 20,
    },
  } as const

  const MAX_RENDER_SCALE = 0.75
  const FIT_MARGIN = 0.12

  const LOGO_LAYOUT = {
    narrowAspect: 0.65,
    wideAspect: 1.8,
    narrowY: 0.2,
    wideY: 0.3,
  } as const

  let tune = {
    resolution: 74,
    pointSpacing: 5,
    maskFontSize: 235,
    maskCenterY: 198,
    maskGap: 40,
    maskWorldWidth: 5.8,
    maskLetterGap: 0.72,
    maskGlyphWidth: 0.9,
    maskAlpha: 80,
    edgePadding: 0.055,
    maskFillWidth: 1,
    maskFillHeight: 0.72,
    ballCount: 1400,
    ballSize: 0.2,
    isolation: 70,
    strength: 0.5,
    subtract: 10,
    renderScale: 0.75,
    scaleZ: 1.2,
    waveAmount: 0.015,
    waveSpeed: 1.25,
    depthAmount: 0.005,
    pointerPush: 0.18,
    pointerFalloff: 2.2,
    pointerDecay: 0.93,
    pointerMaxForce: 1.0,
    roughness: 1,
    metalness: 0.0,
    clearcoat: 0.85,
    transmission: 0.17,
    opacity: 1,
    glowOpacity: 0,
    glowFalloff: 2.2,
  }

  type TuneKey = keyof typeof tune

  const controlGroups = [
    {
      title: 'Field',
      controls: [
        { key: 'pointSpacing', label: 'Point spacing', min: 4, max: 40, step: 1 },
        { key: 'ballCount', label: 'Ball count', min: 12, max: 6000, step: 1 },
        { key: 'ballSize', label: 'Ball size', min: 0.2, max: 3, step: 0.05 },
        { key: 'isolation', label: 'Isolation', min: 8, max: 90, step: 1 },
        { key: 'strength', label: 'Ball strength', min: 0.05, max: 1.2, step: 0.01 },
        { key: 'subtract', label: 'Ball subtract', min: 3, max: 28, step: 0.25 },
      ],
    },
    {
      title: 'Mask',
      controls: [
        { key: 'maskFontSize', label: 'Glyph size', min: 80, max: 320, step: 1 },
        { key: 'maskCenterY', label: 'Vertical mask', min: 80, max: 300, step: 1 },
        { key: 'maskGap', label: 'Canvas gap', min: -20, max: 120, step: 1 },
        { key: 'maskWorldWidth', label: 'Mask width', min: 2.5, max: 8, step: 0.05 },
        { key: 'maskLetterGap', label: 'Letter gap', min: -0.2, max: 0.8, step: 0.01 },
        { key: 'maskGlyphWidth', label: 'Glyph width', min: 0.35, max: 1.4, step: 0.01 },
        { key: 'maskAlpha', label: 'Alpha cutoff', min: 1, max: 254, step: 1 },
        { key: 'edgePadding', label: 'Edge padding', min: 0, max: 0.25, step: 0.005 },
        { key: 'maskFillWidth', label: 'Fill width', min: 0.1, max: 1.4, step: 0.01 },
        { key: 'maskFillHeight', label: 'Fill height', min: 0.1, max: 1.2, step: 0.01 },
      ],
    },
    {
      title: 'Shape',
      controls: [
        { key: 'renderScale', label: 'Render scale', min: 0.05, max: 0.75, step: 0.05 },
        { key: 'scaleZ', label: 'Thickness', min: 0.05, max: 1.2, step: 0.01 },
        { key: 'depthAmount', label: 'Depth motion', min: 0, max: 0.28, step: 0.005 },
      ],
    },
    {
      title: 'Motion',
      controls: [
        { key: 'waveAmount', label: 'Wave amount', min: 0, max: 0.18, step: 0.005 },
        { key: 'waveSpeed', label: 'Wave speed', min: 0, max: 5, step: 0.05 },
        { key: 'pointerPush', label: 'Pointer push', min: -0.6, max: 0.8, step: 0.01 },
        { key: 'pointerFalloff', label: 'Pointer falloff', min: 0.5, max: 8, step: 0.05 },
        { key: 'pointerDecay', label: 'Pointer decay', min: 0.75, max: 0.995, step: 0.005 },
        { key: 'pointerMaxForce', label: 'Pointer force', min: 0, max: 3, step: 0.05 },
      ],
    },
    {
      title: 'Honey',
      controls: [
        { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
        { key: 'metalness', label: 'Metalness', min: 0, max: 0.5, step: 0.01 },
        { key: 'clearcoat', label: 'Clearcoat', min: 0, max: 1, step: 0.01 },
        { key: 'transmission', label: 'Transmission', min: 0, max: 0.4, step: 0.01 },
        { key: 'opacity', label: 'Opacity', min: 0.2, max: 1, step: 0.01 },
        { key: 'glowOpacity', label: 'Glow opacity', min: 0, max: 0.5, step: 0.005 },
        { key: 'glowFalloff', label: 'Glow falloff', min: 0.4, max: 8, step: 0.05 },
      ],
    },
  ] satisfies Array<{
    title: string
    controls: Array<{ key: TuneKey; label: string; min: number; max: number; step: number }>
  }>

  function stopControlsClick(event: Event) {
    event.stopPropagation()
  }

  function toggleControls() {
    showControls = !showControls
  }

  function handleControlsShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || event.repeat || event.key.toLowerCase() !== 's') return

    const target = event.target as HTMLElement | null
    if (
      target?.closest('input, textarea, select, button') ||
      target?.isContentEditable
    ) {
      return
    }

    event.preventDefault()
    toggleControls()
  }

  function setTune(key: TuneKey, event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value)
    tune = {
      ...tune,
      [key]: key === 'renderScale' ? THREE.MathUtils.clamp(value, 0.05, MAX_RENDER_SCALE) : value,
    }
  }

  function getRequestedRenderScale() {
    return THREE.MathUtils.clamp(tune.renderScale, 0.05, MAX_RENDER_SCALE)
  }

  function getLogoOffsetY(aspect: number) {
    const t = THREE.MathUtils.clamp(
      (aspect - LOGO_LAYOUT.narrowAspect) / (LOGO_LAYOUT.wideAspect - LOGO_LAYOUT.narrowAspect),
      0,
      1,
    )

    return THREE.MathUtils.lerp(LOGO_LAYOUT.narrowY, LOGO_LAYOUT.wideY, t)
  }

  function getFittedRenderScale(camera: THREE.OrthographicCamera, logoField: LogoField, logoOffsetY: number) {
    const requestedScale = getRequestedRenderScale()
    const halfCameraWidth = Math.max(0.001, camera.right)
    const maxLogoHalfSpan = Math.max(0.001, Math.abs(logoField.centerX) + logoField.halfWidth)
    const fitScaleX = Math.max(0.05, (halfCameraWidth - FIT_MARGIN) / maxLogoHalfSpan)

    const fitScaleY = Math.max(
      0.05,
      Math.min(camera.top - logoOffsetY - FIT_MARGIN, logoOffsetY - camera.bottom - FIT_MARGIN),
    )

    return Math.max(0.05, Math.min(requestedScale, fitScaleX, fitScaleY))
  }

  function exportTune() {
    const blob = new Blob([JSON.stringify(tune, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'syrup-logo-controls.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importTune(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    try {
      const parsed = JSON.parse(await file.text()) as Partial<Record<TuneKey, unknown>>
      const nextTune = { ...tune }

      for (const key of Object.keys(tune) as TuneKey[]) {
        const value = parsed[key]
        if (typeof value === 'number' && Number.isFinite(value)) {
          nextTune[key] = key === 'renderScale' ? THREE.MathUtils.clamp(value, 0.05, MAX_RENDER_SCALE) : value
        }
      }

      tune = nextTune
    } catch (error) {
      console.error('Could not import Syrup controls.', error)
    }

    input.value = ''
  }

  function makeLetterFields(pointSpacing = 12) {
    const canvas = document.createElement('canvas')
    canvas.width = SIM.mask.canvasWidth
    canvas.height = SIM.mask.canvasHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Could not create Syrup metaball mask.')

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 ${tune.maskFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`
    ctx.fillStyle = '#ffffff'
    const fields: LetterField[] = []

    const letters = [...SIM.mask.text]
    const measure = (letter: string) => ctx.measureText(letter).width
    const widths = letters.map(measure)
    const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    const gapPx = tune.maskGap
    let cursor = (canvas.width - totalWidth - gapPx * (letters.length - 1)) / 2

    letters.forEach((letter, letterIndex) => {
      const width = widths[letterIndex]
      const centerX = cursor + width / 2
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillText(letter, centerX, tune.maskCenterY)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const targets: Target[] = []
      let minX = canvas.width
      let maxX = 0
      let minY = canvas.height
      let maxY = 0

      const alphaAt = (x: number, y: number) => {
        const px = THREE.MathUtils.clamp(Math.round(x), 0, canvas.width - 1)
        const py = THREE.MathUtils.clamp(Math.round(y), 0, canvas.height - 1)
        return image.data[(py * canvas.width + px) * 4 + 3]
      }
      const spacing = Math.max(1, Math.round(pointSpacing))
      const firstPassStep = 3
      for (let y = 8; y < canvas.height - 8; y += firstPassStep) {
        for (let x = Math.max(0, Math.floor(cursor - 20)); x < Math.min(canvas.width, Math.ceil(cursor + width + 20)); x += firstPassStep) {
          if (alphaAt(x, y) >= tune.maskAlpha) {
            minX = Math.min(minX, x)
            maxX = Math.max(maxX, x)
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
          }
        }
      }

      const rowSpacing = Math.max(1, Math.round(spacing * 0.86))
      const startX = Math.ceil(minX / spacing) * spacing
      const startY = Math.ceil(minY / rowSpacing) * rowSpacing
      const seedBase = letterIndex * 1000

      let row = 0
      for (let y = startY; y <= maxY; y += rowSpacing) {
        const rowOffset = row % 2 === 0 ? 0 : spacing / 2
        for (let x = startX + rowOffset; x <= maxX; x += spacing) {
          if (alphaAt(x, y) >= tune.maskAlpha) {
            const indexSeed = seedBase + targets.length
            targets.push({
              x: (x - minX) / Math.max(1, maxX - minX),
              y: 1 - (y - minY) / Math.max(1, maxY - minY),
              seed: Math.sin(indexSeed * 12.9898) * 43758.5453,
            })
          }
        }
        row += 1
      }

      fields.push({
        centerX: (centerX / canvas.width - 0.5) * tune.maskWorldWidth + (letterIndex - (letters.length - 1) / 2) * tune.maskLetterGap,
        scaleX: Math.max(0.32, ((maxX - minX) / canvas.width) * tune.maskWorldWidth * tune.maskGlyphWidth),
        targets,
      })

      cursor += width + gapPx
    })

    return fields
  }

  function makeLogoField(pointSpacing = 12): LogoField {
    const letterFields = makeLetterFields(pointSpacing)
    const minX = Math.min(...letterFields.map((field) => field.centerX - field.scaleX))
    const maxX = Math.max(...letterFields.map((field) => field.centerX + field.scaleX))
    const centerX = (minX + maxX) / 2
    const halfWidth = Math.max(0.001, (maxX - minX) / 2)

    const targets = letterFields.flatMap((field) =>
      field.targets.map((target) => {
        const worldX = field.centerX + (target.x * 2 - 1) * field.scaleX
        return {
          x: (worldX - centerX) / Math.max(0.001, halfWidth * 2) + 0.5,
          y: target.y,
          seed: target.seed,
        }
      }),
    )

    return { centerX, halfWidth, targets }
  }

  function getMaskKey() {
    return [
      tune.pointSpacing,
      tune.maskFontSize,
      tune.maskCenterY,
      tune.maskGap,
      tune.maskWorldWidth,
      tune.maskLetterGap,
      tune.maskGlyphWidth,
      tune.maskAlpha,
    ].join(':')
  }

  $: if (pauseAnimation && resumeAnimation) {
    if (paused) pauseAnimation()
    else resumeAnimation()
  }

  onMount(() => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-3.6, 3.6, 1.55, -1.55, 0.1, 30)
    camera.position.z = 8

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const material = new THREE.MeshPhysicalMaterial({
      color: '#d87905',
      emissive: '#261000',
      emissiveIntensity: 0.14,
      roughness: tune.roughness,
      metalness: tune.metalness,
      clearcoat: tune.clearcoat,
      clearcoatRoughness: 0.1,
      transmission: tune.transmission,
      thickness: 0.8,
      transparent: true,
      opacity: tune.opacity,
    })

    let logoField = makeLogoField(tune.pointSpacing)
    let lastMaskKey = getMaskKey()
    const effect = new MarchingCubes(tune.resolution, material, false, false, 40000)
    let logoOffsetY = 0
    let renderScale = getRequestedRenderScale()
    effect.isolation = tune.isolation
    effect.position.set(logoField.centerX * renderScale, logoOffsetY, 0)
    effect.scale.set(logoField.halfWidth * renderScale, renderScale, tune.scaleZ)
    scene.add(effect)

    scene.add(new THREE.AmbientLight(0xfff0c2, 1.8))
    const key = new THREE.DirectionalLight(0xffffff, 3.4)
    key.position.set(-2.5, 4, 6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0xff9a1c, 1.6)
    rim.position.set(3, -1.5, 5)
    scene.add(rim)

    const glowMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uGlowColor: { value: new THREE.Color('#ffa321') },
        uGlowShape: { value: new THREE.Vector2(tune.glowFalloff, tune.glowOpacity) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 uGlowColor;
        uniform vec2 uGlowShape;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float glow = exp(-dot(p, p) * uGlowShape.x);
          gl_FragColor = vec4(uGlowColor, glow * uGlowShape.y);
        }
      `,
    })
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(6.7, 2.4), glowMaterial)
    glow.position.set(0, logoOffsetY, -0.4)
    scene.add(glow)

    const pointer = new THREE.Vector2(SIM.pointer.offscreen, SIM.pointer.offscreen)
    let pointerForce = 0
    let pointerActive = false
    let isAnimating = false
    let disposed = false

    function resize() {
      if (!renderer) return
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      renderer.setSize(width, height, false)
      const aspect = width / height
      camera.left = -SIM.camera.halfWidthByAspect * aspect
      camera.right = SIM.camera.halfWidthByAspect * aspect
      camera.top = SIM.camera.halfHeight
      camera.bottom = -SIM.camera.halfHeight
      camera.updateProjectionMatrix()
      logoOffsetY = getLogoOffsetY(aspect)
      renderScale = getFittedRenderScale(camera, logoField, logoOffsetY)
    }

    function movePointer(event: PointerEvent) {
      const rect = host.getBoundingClientRect()
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      const world = new THREE.Vector3(ndcX, ndcY, 0).unproject(camera)
      pointer.set(world.x, world.y)
      pointerActive = true
      pointerForce = tune.pointerMaxForce
    }

    function leavePointer() {
      pointerActive = false
      pointerForce = 0
      pointer.set(SIM.pointer.offscreen, SIM.pointer.offscreen)
    }

    host.addEventListener('pointermove', movePointer)
    host.addEventListener('pointerleave', leavePointer)
    window.addEventListener('keydown', handleControlsShortcut)
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(host)
    resize()

    const clock = new THREE.Clock()
    function renderFrame() {
      const time = clock.getElapsedTime()
      pointerForce = pointerActive ? tune.pointerMaxForce : pointerForce * tune.pointerDecay

      material.roughness = tune.roughness
      material.metalness = tune.metalness
      material.clearcoat = tune.clearcoat
      material.transmission = tune.transmission
      material.opacity = tune.opacity
      glowMaterial.uniforms.uGlowShape.value.set(tune.glowFalloff, tune.glowOpacity)

      const maskKey = getMaskKey()
      if (maskKey !== lastMaskKey) {
        logoField = makeLogoField(tune.pointSpacing)
        lastMaskKey = maskKey
      }
      logoOffsetY = getLogoOffsetY((camera.right - camera.left) / Math.max(0.001, camera.top - camera.bottom))
      renderScale = getFittedRenderScale(camera, logoField, logoOffsetY)

      const scaledStrength = tune.strength * tune.ballSize * tune.ballSize
      effect.reset()
      effect.isolation = tune.isolation
      effect.position.x = logoField.centerX * renderScale
      effect.position.y = logoOffsetY
      effect.scale.set(logoField.halfWidth * renderScale, renderScale, tune.scaleZ)
      glow.position.y = logoOffsetY

      const ballLimit = Math.max(1, Math.min(logoField.targets.length, Math.round(tune.ballCount)))
      for (let i = 0; i < ballLimit; i += 1) {
        const target = logoField.targets[Math.floor((i / ballLimit) * logoField.targets.length)]
        const wave = Math.sin(time * tune.waveSpeed + target.seed) * tune.waveAmount
        let ballX = 0.5 + (target.x - 0.5) * tune.maskFillWidth + Math.cos(target.seed * 3.1) * wave
        let ballY = 0.5 + (target.y - 0.5) * tune.maskFillHeight + Math.sin(target.seed * 2.7) * wave
        const edgePadding = THREE.MathUtils.clamp(tune.edgePadding, 0, 0.45)
        ballX = edgePadding + ballX * (1 - edgePadding * 2)
        ballY = edgePadding + ballY * (1 - edgePadding * 2)
        const worldX = effect.position.x + (ballX * 2 - 1) * effect.scale.x
        const worldY = effect.position.y + (ballY * 2 - 1) * effect.scale.y
        const dx = worldX - pointer.x
        const dy = worldY - pointer.y
        const d = Math.hypot(dx, dy)
        const influence = Math.exp(-d * tune.pointerFalloff) * pointerForce
        if (d > 0.0001) {
          ballX += (dx / d) * influence * tune.pointerPush / Math.max(0.001, effect.scale.x * 2)
          ballY += (dy / d) * influence * tune.pointerPush / Math.max(0.001, effect.scale.y * 2)
        }

        const ballZ = THREE.MathUtils.clamp(0.5 + Math.sin(time * 0.9 + target.seed) * tune.depthAmount, 0.12, 0.88)
        effect.addBall(
          THREE.MathUtils.clamp(ballX, edgePadding, 1 - edgePadding),
          THREE.MathUtils.clamp(ballY, edgePadding, 1 - edgePadding),
          ballZ,
          scaledStrength,
          tune.subtract,
        )
      }
      effect.update()

      renderer?.render(scene, camera)
    }

    function animate() {
      if (!isAnimating || disposed) return

      renderFrame()
      animationFrame = requestAnimationFrame(animate)
    }

    pauseAnimation = () => {
      isAnimating = false
      if (animationFrame) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }
    }

    resumeAnimation = () => {
      if (disposed || isAnimating) return
      isAnimating = true
      animationFrame = requestAnimationFrame(animate)
    }

    renderFrame()
    if (!paused) resumeAnimation()

    cleanup = () => {
      disposed = true
      pauseAnimation?.()
      host.removeEventListener('pointermove', movePointer)
      host.removeEventListener('pointerleave', leavePointer)
      window.removeEventListener('keydown', handleControlsShortcut)
      resizeObserver?.disconnect()
      effect.geometry.dispose()
      material.dispose()
      glow.geometry.dispose()
      glowMaterial.dispose()
      renderer?.dispose()
      renderer?.domElement.remove()
      renderer = null
      pauseAnimation = null
      resumeAnimation = null
    }
  })

  onDestroy(() => {
    cleanup?.()
  })
</script>

<div class="syrup-logo" bind:this={host} aria-label="Interactive honey metaball logo"></div>

{#if showControls}
  <div class="syrup-tuner" role="group" aria-label="Syrup simulation controls" onpointerdown={stopControlsClick}>
    <div class="syrup-tuner-actions">
      <button type="button" onclick={exportTune}>Export controls</button>
      <button type="button" onclick={() => importInput?.click()}>Import controls</button>
      <input bind:this={importInput} type="file" accept="application/json,.json" onchange={importTune} />
    </div>

    <div class="syrup-tuner-grid">
      {#each controlGroups as group}
        <section class="syrup-tuner-group">
          <h2>{group.title}</h2>
          {#each group.controls as control}
            <label>
              <span>{control.label}</span>
              <input
                type="number"
                min={control.min}
                max={control.max}
                step={control.step}
                value={tune[control.key]}
                oninput={(event) => setTune(control.key, event)}
              />
            </label>
          {/each}
        </section>
      {/each}
    </div>
  </div>
{/if}
