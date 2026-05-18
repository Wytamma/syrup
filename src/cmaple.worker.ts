import type { AlignmentFormat, AlignmentStats, CmapleWorkerRequest, CmapleWorkerResponse } from './types/cmaple'

type EmscriptenModule = {
  HEAPU8: Uint8Array
  _cmaple_alloc: (size: number) => number
  _cmaple_free: (ptr: number) => void
  _cmaple_release: (handle: number) => void
  _cmaple_analyze: (ptr: number, size: number, format: number) => number
  _cmaple_infer: (ptr: number, size: number, format: number, numThreads: number) => number
  _cmaple_infer_loaded: (handle: number, numThreads: number) => number
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

function bench(id: string | undefined, message: string) {
  console.info(`[CMAPLE bench] ${id ? `id=${id} ` : ''}${message}`)
}

function readCStringFromBytes(bytes: Uint8Array, ptr: number) {
  let end = ptr
  while (bytes[end] !== 0) end += 1
  return new TextDecoder().decode(Uint8Array.from(bytes.subarray(ptr, end)))
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
      const scriptResponse = await fetch('/cmaple-threaded.js')
      if (!scriptResponse.ok) {
        throw new Error('CMAPLE threaded artifact is missing. Run `npm run build:wasm` first.')
      }

      const scriptSource = await scriptResponse.text()
      const scriptBlob = new Blob([scriptSource], { type: 'text/javascript' })
      const scriptUrl = URL.createObjectURL(scriptBlob)
      const module = await import(/* @vite-ignore */ scriptUrl)
      const createCmapleModule = module.default as (options: Record<string, unknown>) => Promise<EmscriptenModule>

      const moduleInstance = await createCmapleModule({
        locateFile: (path: string) => `/${path}`,
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

    post({
      type: 'log',
      id: message.id,
      message: 'Using Pixi/Emscripten CMAPLE WASM runtime.',
      stream: 'stdout',
    })
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
        `cpus=${navigator.hardwareConcurrency || 'unknown'}`,
        `crossOriginIsolated=${crossOriginIsolated}`,
        `runtimeReadyMs=${ms(runtimeReadyMs)}`,
        `heapMiB=${heapMiB(module)}`,
      ].join(' '),
    )
    const inferStartedAt = performance.now()
    const resultPtr = module._cmaple_infer_loaded(stored.wasmHandle, message.numThreads)
    if (!resultPtr) throw new Error('CMAPLE did not return a result.')
    const json = readCStringFromBytes(module.HEAPU8, resultPtr)
    module._cmaple_free(resultPtr)
    const inferMs = performance.now() - inferStartedAt
    const result = JSON.parse(json) as CmapleWorkerResponse
    if (result.type === 'result') {
      result.id = message.id
      bench(
        message.id,
        [
          'infer.done',
          `inferMs=${ms(inferMs)}`,
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
