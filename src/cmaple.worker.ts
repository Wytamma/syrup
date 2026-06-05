import type {
  AlignmentFormat,
  AlignmentStats,
  AlignmentWarningSummary,
  CmapleWorkerRequest,
  CmapleWorkerResponse,
  ConstantSiteCounts,
} from './types/cmaple'

type EmscriptenModule = {
  HEAPU8: Uint8Array
  _cmaple_alloc: (size: number) => number
  _cmaple_free: (ptr: number) => void
  _cmaple_release: (handle: number) => void
  _cmaple_analyze: (ptr: number, size: number, format: number) => number
  _cmaple_infer: (
    ptr: number,
    size: number,
    format: number,
    numThreads: number,
    branchSupportMethod: number,
    branchSupportReplicates: number,
    branchSupportEpsilon: number,
    filterDivergentSamples: number,
    maxDivergencePercent: number,
    constantA: number,
    constantC: number,
    constantG: number,
    constantT: number,
  ) => number
  _cmaple_infer_loaded: (
    handle: number,
    numThreads: number,
    branchSupportMethod: number,
    branchSupportReplicates: number,
    branchSupportEpsilon: number,
    filterDivergentSamples: number,
    maxDivergencePercent: number,
    constantA: number,
    constantC: number,
    constantG: number,
    constantT: number,
  ) => number
  _cmaple_warning_summary: (
    handle: number,
    filterDivergentSamples: number,
    maxDivergencePercent: number,
    constantA: number,
    constantC: number,
    constantG: number,
    constantT: number,
  ) => number
  _cmaple_export_maple: (handle: number) => number
}

type StoredAlignment = {
  fileName: string
  format: AlignmentFormat
  fileSize: number
  wasmHandle?: number
  stats?: AlignmentStats
  effective?: boolean
}

type PreflightWithHandle = CmapleWorkerResponse & {
  handle?: number
}

type AlignmentCallResult = {
  json: string
  allocMs: number
  copyMs: number
  nativeMs: number
  decodeMs: number
}

let runtimePromise: Promise<EmscriptenModule> | null = null
let runtimeLoadMs: number | null = null
const alignments = new Map<string, StoredAlignment>()

const formatIds = {
  auto: 0,
  fasta: 1,
  phylip: 2,
  maple: 3,
} as const

const branchSupportMethodIds = {
  none: 0,
  sprta: 1,
  'sh-alrt': 2,
} as const

function post(response: CmapleWorkerResponse) {
  if (response.type === 'log') {
    const logger = response.stream === 'stderr' ? console.warn : console.info
    logger(`[CMAPLE ${response.stream}] ${response.message}`)
  }
  self.postMessage(response)
}

function bytesToMiB(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(2)
}

function ms(value: number) {
  return value.toFixed(1)
}

function heapMiB(module: EmscriptenModule) {
  return bytesToMiB(module.HEAPU8.byteLength)
}

function sanitizeConstantSites(counts: ConstantSiteCounts) {
  return {
    a: Math.max(0, Math.floor(Number(counts.a) || 0)),
    c: Math.max(0, Math.floor(Number(counts.c) || 0)),
    g: Math.max(0, Math.floor(Number(counts.g) || 0)),
    t: Math.max(0, Math.floor(Number(counts.t) || 0)),
  }
}

function bench(id: string | undefined, message: string) {
  console.info(`[CMAPLE bench] ${id ? `id=${id} ` : ''}${message}`)
}

function readCStringFromBytes(bytes: Uint8Array, ptr: number) {
  let end = ptr
  while (bytes[end] !== 0) end += 1
  return new TextDecoder().decode(Uint8Array.from(bytes.subarray(ptr, end)))
}

function getLikelyLongRunWarning(summary: AlignmentWarningSummary) {
  const largeAlignmentWarning =
    summary.sequenceCount * summary.sequenceLength >= 50_000_000
      ? 'This is a large alignment and may take several minutes in the browser, especially with branch support enabled.'
      : ''

  const variableColumnsPerKb = summary.sequenceLength ? summary.variableColumns / (summary.sequenceLength / 1000) : 0
  const hasDenseVariation = summary.variableColumns >= 2000 && variableColumnsPerKb >= 50
  const hasSubstantialAmbiguity = summary.meanAmbiguousSites >= 100 && summary.ambiguousFraction >= 0.01
  const hasDifficultVariation = hasDenseVariation && hasSubstantialAmbiguity

  if (largeAlignmentWarning || hasDifficultVariation) {
    const details = [
      hasDifficultVariation ? `${summary.variableColumns.toLocaleString()} variable columns` : '',
      hasDifficultVariation ? `${Math.round(summary.meanAmbiguousSites).toLocaleString()} ambiguous sites per sequence on average` : '',
    ].filter(Boolean)

    return [
      largeAlignmentWarning || 'This alignment may take several minutes in the browser, especially with branch support enabled.',
      details.length ? `It has ${details.join(' and ')}.` : '',
      'Consider turning off branch support for a faster less robust analysis.',
    ].filter(Boolean).join(' ')
  }

  return largeAlignmentWarning
}

async function loadCmaple() {
  if (runtimePromise) return runtimePromise

  runtimePromise = (async () => {
    const startedAt = performance.now()
    if (!self.crossOriginIsolated) {
      throw new Error(
        'Threaded WASM requires cross-origin isolation headers (Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp).',
      )
    }

    try {
      const runtimeAssetVersion = Date.now().toString(36)
      const scriptResponse = await fetch(`/cmaple-threaded.js?v=${runtimeAssetVersion}`, { cache: 'no-store' })
      if (!scriptResponse.ok) {
        throw new Error('CMAPLE threaded artifact is missing. Run `npm run build:wasm` first.')
      }

      const scriptSource = await scriptResponse.text()
      const scriptBlob = new Blob([scriptSource], { type: 'text/javascript' })
      const scriptUrl = URL.createObjectURL(scriptBlob)
      const module = await import(/* @vite-ignore */ scriptUrl)
      const createCmapleModule = module.default as (options: Record<string, unknown>) => Promise<EmscriptenModule>

      const moduleInstance = await createCmapleModule({
        locateFile: (path: string) => `/${path}?v=${runtimeAssetVersion}`,
        mainScriptUrlOrBlob: scriptBlob,
        print: (message: string) => {
          post({ type: 'log', message, stream: 'stdout' })
        },
        printErr: (message: string) => {
          post({ type: 'log', message, stream: 'stderr' })
        },
      })

      runtimeLoadMs = performance.now() - startedAt
      return moduleInstance
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'CMAPLE Emscripten runtime could not be loaded.')
    }
  })()

  return runtimePromise
}

function callWithAlignment(
  module: EmscriptenModule,
  data: Uint8Array,
  callback: (ptr: number) => number,
) : AlignmentCallResult {
  const allocStartedAt = performance.now()
  const ptr = module._cmaple_alloc(data.byteLength)
  if (!ptr) throw new Error('Could not allocate WASM memory for the alignment.')
  const allocMs = performance.now() - allocStartedAt

  const copyStartedAt = performance.now()
  module.HEAPU8.set(data, ptr)
  const copyMs = performance.now() - copyStartedAt

  const nativeStartedAt = performance.now()
  const resultPtr = callback(ptr)
  const nativeMs = performance.now() - nativeStartedAt
  module._cmaple_free(ptr)

  if (!resultPtr) throw new Error('CMAPLE did not return a result.')

  const decodeStartedAt = performance.now()
  const json = readCStringFromBytes(module.HEAPU8, resultPtr)
  const decodeMs = performance.now() - decodeStartedAt
  module._cmaple_free(resultPtr)
  return { json, allocMs, copyMs, nativeMs, decodeMs }
}

self.onmessage = async (event: MessageEvent<CmapleWorkerRequest>) => {
  const message = event.data
  const requestStartedAt = performance.now()

  try {
    if (message.type === 'clear') {
      const stored = alignments.get(message.id)
      alignments.delete(message.id)
      if (stored?.wasmHandle && runtimePromise) {
        const module = await loadCmaple()
        module._cmaple_release(stored.wasmHandle)
      }
      return
    }

    const module = await loadCmaple()
    const runtimeReadyMs = performance.now() - requestStartedAt

    if (message.type === 'load') {
      const stored: StoredAlignment = {
        fileName: message.fileName,
        format: message.format,
        fileSize: message.data.byteLength,
      }
      alignments.set(message.id, stored)

      bench(
        message.id,
        [
          'preflight.start',
          `file="${message.fileName}"`,
          `fileSizeMiB=${bytesToMiB(message.data.byteLength)}`,
          `selectedFormat=${message.format}`,
          `cpus=${navigator.hardwareConcurrency || 'unknown'}`,
          `crossOriginIsolated=${crossOriginIsolated}`,
          `runtimeLoadMs=${runtimeLoadMs === null ? 'cached' : ms(runtimeLoadMs)}`,
          `runtimeReadyMs=${ms(runtimeReadyMs)}`,
          `heapMiB=${heapMiB(module)}`,
        ].join(' '),
      )
      const analyzeStartedAt = performance.now()
      const analyzeCall = callWithAlignment(module, message.data, (ptr) =>
        module._cmaple_analyze(ptr, message.data.byteLength, formatIds[message.format]),
      )
      const analyzeMs = performance.now() - analyzeStartedAt
      const preflight = JSON.parse(analyzeCall.json) as PreflightWithHandle
      if (preflight.type === 'preflight') {
        if (!preflight.handle) {
          throw new Error('CMAPLE did not return a parsed alignment handle.')
        }
        preflight.id = message.id
        preflight.stats.fileName = message.fileName
        preflight.stats.fileSize = message.data.byteLength
        const longRunWarning = getLikelyLongRunWarning(preflight.warningSummary)
        if (longRunWarning) preflight.warnings = [...preflight.warnings, longRunWarning]
        stored.wasmHandle = preflight.handle
        stored.stats = preflight.stats
        stored.effective = preflight.effective
        delete preflight.handle
        bench(
          message.id,
          [
            'preflight.done',
            `analyzeMs=${ms(analyzeMs)}`,
            `wasmAllocMs=${ms(analyzeCall.allocMs)}`,
            `wasmCopyMs=${ms(analyzeCall.copyMs)}`,
            `nativeMs=${ms(analyzeCall.nativeMs)}`,
            `decodeMs=${ms(analyzeCall.decodeMs)}`,
            `totalMs=${ms(performance.now() - requestStartedAt)}`,
            `heapMiB=${heapMiB(module)}`,
            `detectedFormat=${preflight.stats.format}`,
            `sequenceCount=${preflight.stats.sequenceCount}`,
            `sequenceLength=${preflight.stats.sequenceLength}`,
            `effective=${preflight.effective}`,
          ].join(' '),
        )
      }
      post(preflight)
      return
    }

    const stored = alignments.get(message.id)
    if (!stored) throw new Error('No alignment is loaded. Drop the file again.')
    if (!stored.wasmHandle) throw new Error('The parsed alignment is unavailable. Drop the file again.')

    if (message.type === 'summarize-filter') {
      const constantSites = sanitizeConstantSites(message.constantSites)
      const summaryStartedAt = performance.now()
      const resultPtr = module._cmaple_warning_summary(
        stored.wasmHandle,
        message.filterDivergentSamples ? 1 : 0,
        message.maxDivergencePercent,
        constantSites.a,
        constantSites.c,
        constantSites.g,
        constantSites.t,
      )
      if (!resultPtr) throw new Error('CMAPLE did not return a warning summary.')
      const decodeStartedAt = performance.now()
      const json = readCStringFromBytes(module.HEAPU8, resultPtr)
      const decodeMs = performance.now() - decodeStartedAt
      module._cmaple_free(resultPtr)
      const result = JSON.parse(json) as CmapleWorkerResponse
      if (result.type === 'error') {
        post({ ...result, id: message.id })
        return
      }
      if (result.type !== 'warning-summary') {
        throw new Error('CMAPLE returned an unexpected warning summary.')
      }
      result.id = message.id
      bench(
        message.id,
        [
          'summary.done',
          `summaryMs=${ms(performance.now() - summaryStartedAt)}`,
          `decodeMs=${ms(decodeMs)}`,
          `filter=${message.filterDivergentSamples}`,
          `maxDivergencePercent=${message.maxDivergencePercent}`,
          `constantSites=${Object.values(constantSites).join(',')}`,
          `sequenceCount=${result.warningSummary.sequenceCount}`,
          `removedCount=${result.warningSummary.removedCount}`,
        ].join(' '),
      )
      post(result)
      return
    }

    if (message.type === 'export-maple') {
      const exportStartedAt = performance.now()
      const resultPtr = module._cmaple_export_maple(stored.wasmHandle)
      if (!resultPtr) throw new Error('CMAPLE did not return a MAPLE export.')
      const decodeStartedAt = performance.now()
      const json = readCStringFromBytes(module.HEAPU8, resultPtr)
      const decodeMs = performance.now() - decodeStartedAt
      module._cmaple_free(resultPtr)
      const result = JSON.parse(json) as CmapleWorkerResponse
      if (result.type !== 'log') result.id = message.id
      if (result.type === 'maple-export') {
        bench(
          message.id,
          [
            'maple-export.done',
            `exportMs=${ms(performance.now() - exportStartedAt)}`,
            `decodeMs=${ms(decodeMs)}`,
            `mapleChars=${result.maple.length}`,
            `heapMiB=${heapMiB(module)}`,
          ].join(' '),
        )
      }
      post(result)
      return
    }

    const constantSites = sanitizeConstantSites(message.constantSites)
    bench(
      message.id,
      [
        'infer.start',
        `file="${stored.fileName}"`,
        `fileSizeMiB=${bytesToMiB(stored.fileSize)}`,
        `selectedFormat=${stored.format}`,
        'parsedAlignment=reused',
        `wasmHandle=${stored.wasmHandle}`,
        `detectedFormat=${stored.stats?.format ?? 'unknown'}`,
        `sequenceCount=${stored.stats?.sequenceCount ?? 'unknown'}`,
        `sequenceLength=${stored.stats?.sequenceLength ?? 'unknown'}`,
        `effective=${stored.effective ?? 'unknown'}`,
        `requestedThreads=${message.numThreads}`,
        `branchSupportMethod=${message.branchSupportMethod}`,
        `branchSupportReplicates=${message.branchSupportReplicates}`,
        `branchSupportEpsilon=${message.branchSupportEpsilon}`,
        `divergenceFilter=${message.filterDivergentSamples}`,
        `maxDivergencePercent=${message.maxDivergencePercent}`,
        `constantSites=${Object.values(constantSites).join(',')}`,
        `cpus=${navigator.hardwareConcurrency || 'unknown'}`,
        `crossOriginIsolated=${crossOriginIsolated}`,
        `runtimeReadyMs=${ms(runtimeReadyMs)}`,
        `heapMiB=${heapMiB(module)}`,
      ].join(' '),
    )
    const inferStartedAt = performance.now()
    const resultPtr = module._cmaple_infer_loaded(
      stored.wasmHandle,
      message.numThreads,
      branchSupportMethodIds[message.branchSupportMethod],
      message.branchSupportReplicates,
      message.branchSupportEpsilon,
      message.filterDivergentSamples ? 1 : 0,
      message.maxDivergencePercent,
      constantSites.a,
      constantSites.c,
      constantSites.g,
      constantSites.t,
    )
    if (!resultPtr) throw new Error('CMAPLE did not return a result.')
    const decodeStartedAt = performance.now()
    const json = readCStringFromBytes(module.HEAPU8, resultPtr)
    const decodeMs = performance.now() - decodeStartedAt
    module._cmaple_free(resultPtr)
    const inferMs = performance.now() - inferStartedAt
    const result = JSON.parse(json) as CmapleWorkerResponse
    if (result.type !== 'log') result.id = message.id
    if (result.type === 'result') {
      bench(
        message.id,
        [
          'infer.done',
          `inferMs=${ms(inferMs)}`,
          `decodeMs=${ms(decodeMs)}`,
          `totalMs=${ms(performance.now() - requestStartedAt)}`,
          `heapMiB=${heapMiB(module)}`,
          `logLikelihood=${result.logLikelihood}`,
          `newickChars=${result.newick.length}`,
        ].join(' '),
      )
    }
    post(result)
  } catch (err) {
    post({
      type: 'error',
      id: 'id' in message ? message.id : undefined,
      error: err instanceof Error ? err.message : 'CMAPLE inference failed.',
    })
  }
}
