import { MapleAlignment } from './alignment.js'
import { MapleError } from './errors.js'
import {
  branchSupportMethodId,
  formatId,
  substitutionModelId,
  treeSearchTypeId,
} from './ids.js'
import { resolveInferenceOptions, resolveWarningSummaryOptions } from './options.js'
import type {
  AlignmentStats,
  AlignmentWarningSummary,
  InferenceOptions,
  InferenceResult,
  ParseOptions,
  Preflight,
  RuntimeOptions,
  WarningSummaryOptions,
} from './types.js'

export type EmscriptenModule = {
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
    substitutionModel: number,
    branchSupportMethod: number,
    branchSupportReplicates: number,
    branchSupportEpsilon: number,
    filterDivergentSamples: number,
    maxDivergencePercent: number,
    constantA: number,
    constantC: number,
    constantG: number,
    constantT: number,
    startingTreePtr: number,
    startingTreeSize: number,
    startingAlignmentPtr: number,
    startingAlignmentSize: number,
    branchLengthsFixed: number,
    noReroot: number,
    treeSearchType: number,
    estimateMat: number,
  ) => number
  _cmaple_infer_loaded: (
    handle: number,
    numThreads: number,
    substitutionModel: number,
    branchSupportMethod: number,
    branchSupportReplicates: number,
    branchSupportEpsilon: number,
    filterDivergentSamples: number,
    maxDivergencePercent: number,
    constantA: number,
    constantC: number,
    constantG: number,
    constantT: number,
    startingTreePtr: number,
    startingTreeSize: number,
    startingAlignmentPtr: number,
    startingAlignmentSize: number,
    branchLengthsFixed: number,
    noReroot: number,
    treeSearchType: number,
    estimateMat: number,
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

type EmscriptenFactory = (options: Record<string, unknown>) => Promise<EmscriptenModule>

type NativePreflight = Preflight & { type: 'preflight'; handle: number }
type NativeWarningSummary = { type: 'warning-summary'; warningSummary: AlignmentWarningSummary }
type NativeMapleExport = { type: 'maple-export'; maple: string }
type NativeResult = InferenceResult & { type: 'result' }

export type OneShotInferenceOptions = InferenceOptions & {
  /** Alignment format. Defaults to `auto` detection. */
  format?: ParseOptions['format']
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()
let runtimePromise: Promise<MapleRuntime> | null = null

function readCString(heap: Uint8Array, ptr: number): string {
  let end = ptr
  while (end < heap.length && heap[end] !== 0) end += 1
  if (end === heap.length) {
    throw new MapleError('CMAPLE returned an unterminated string.')
  }
  const view = heap.subarray(ptr, end)
  // Threaded builds use a SharedArrayBuffer heap, which TextDecoder rejects.
  return textDecoder.decode(
    typeof SharedArrayBuffer !== 'undefined' && heap.buffer instanceof SharedArrayBuffer
      ? view.slice()
      : view,
  )
}

function parseNative<T extends { type: string }>(json: string, expected: T['type']): T {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new MapleError('CMAPLE returned invalid JSON.', { cause: error })
  }

  if (value === null || typeof value !== 'object') {
    throw new MapleError('CMAPLE returned an unexpected response.')
  }

  const response = value as { type?: unknown; error?: unknown }
  if (response.type === 'error') {
    throw new MapleError(
      typeof response.error === 'string' ? response.error : 'CMAPLE failed with an unknown error.',
    )
  }
  if (response.type !== expected) {
    throw new MapleError(`CMAPLE returned an unexpected response type: ${String(response.type)}`)
  }
  return value as T
}

async function importEmscriptenFactory(scriptUrl: string): Promise<EmscriptenFactory> {
  let response: Response
  try {
    response = await fetch(scriptUrl, { cache: 'no-store' })
  } catch (error) {
    throw new MapleError(`Could not load the CMAPLE runtime script from ${scriptUrl}.`, { cause: error })
  }

  if (!response.ok) {
    throw new MapleError(
      `Could not load the CMAPLE runtime script from ${scriptUrl} (${response.status} ${response.statusText}).`,
    )
  }

  const blobUrl = URL.createObjectURL(
    new Blob([await response.text()], { type: 'text/javascript' }),
  )
  try {
    const module = (await import(/* @vite-ignore */ blobUrl)) as { default?: EmscriptenFactory }
    if (typeof module.default !== 'function') {
      throw new MapleError('The CMAPLE runtime script did not export a module factory.')
    }
    return module.default
  } catch (error) {
    if (error instanceof MapleError) throw error
    throw new MapleError('The CMAPLE runtime script could not be evaluated.', { cause: error })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

/**
 * A loaded threaded CMAPLE WebAssembly runtime.
 *
 * The runtime is a per-tab singleton: `MapleRuntime.load()` resolves to the
 * same instance for every caller. All inference methods are synchronous and
 * block the calling thread, so call them from a Web Worker.
 */
export class MapleRuntime {
  private readonly module: EmscriptenModule

  private constructor(module: EmscriptenModule) {
    this.module = module
  }

  static load(options: RuntimeOptions = {}): Promise<MapleRuntime> {
    if (!runtimePromise) {
      runtimePromise = MapleRuntime.initialize(options).catch((error) => {
        runtimePromise = null
        throw error
      })
    }
    return runtimePromise
  }

  private static async initialize(options: RuntimeOptions): Promise<MapleRuntime> {
    if (options.requireCrossOriginIsolation !== false && globalThis.crossOriginIsolated !== true) {
      throw new MapleError(
        'Threaded CMAPLE WebAssembly requires a cross-origin isolated page. Serve it with ' +
          '`Cross-Origin-Opener-Policy: same-origin` and ' +
          '`Cross-Origin-Embedder-Policy: require-corp`.',
      )
    }

    const scriptUrl = String(options.scriptUrl ?? new URL('./cmaple-threaded.js', import.meta.url))
    const wasmUrl = String(options.wasmUrl ?? new URL('./cmaple-threaded.wasm', import.meta.url))

    const factory = await importEmscriptenFactory(scriptUrl)
    let module: EmscriptenModule
    try {
      module = await factory({
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : new URL(path, prefix || scriptUrl).href,
        mainScriptUrlOrBlob: scriptUrl,
        print: options.onStdout ?? (() => {}),
        printErr: options.onStderr ?? (() => {}),
      })
    } catch (error) {
      throw new MapleError('CMAPLE WebAssembly runtime could not be initialised.', { cause: error })
    }

    return new MapleRuntime(module)
  }

  /** Size of the WebAssembly heap in bytes. */
  get heapSize(): number {
    return this.module.HEAPU8.byteLength
  }

  /**
   * Parses an alignment and keeps it in WebAssembly memory. The returned
   * alignment must be disposed to release that memory.
   */
  parse(data: Uint8Array, options: ParseOptions = {}): MapleAlignment {
    if (data.byteLength === 0) {
      throw new MapleError('Alignment data is empty.')
    }

    const native = this.callWithInput<NativePreflight>(
      data,
      'preflight',
      (ptr, size) => this.module._cmaple_analyze(ptr, size, formatId(options.format ?? 'auto')),
    )
    const stats: AlignmentStats = {
      ...native.stats,
      fileName: options.fileName ?? '',
      fileSize: data.byteLength,
    }
    return new MapleAlignment(this, { ...native, stats })
  }

  /** Runs a complete parse-and-infer pass without retaining the alignment. */
  infer(data: Uint8Array, options: OneShotInferenceOptions = {}): InferenceResult {
    if (data.byteLength === 0) {
      throw new MapleError('Alignment data is empty.')
    }

    const resolved = resolveInferenceOptions(options)
    const startingTreeBytes = textEncoder.encode(resolved.startingTree)
    const startingAlignmentBytes = textEncoder.encode(resolved.startingAlignment)
    const startingTree = this.allocate(startingTreeBytes)
    const startingAlignment = this.allocate(startingAlignmentBytes)

    try {
      const native = this.callWithInput<NativeResult>(data, 'result', (ptr, size) =>
        this.module._cmaple_infer(
          ptr,
          size,
          formatId(options.format ?? 'auto'),
          resolved.numThreads,
          substitutionModelId(resolved.substitutionModel),
          branchSupportMethodId(resolved.branchSupportMethod),
          resolved.branchSupportReplicates,
          resolved.branchSupportEpsilon,
          resolved.filterDivergentSamples ? 1 : 0,
          resolved.maxDivergencePercent,
          resolved.constantSites.a,
          resolved.constantSites.c,
          resolved.constantSites.g,
          resolved.constantSites.t,
          startingTree,
          startingTreeBytes.byteLength,
          startingAlignment,
          startingAlignmentBytes.byteLength,
          resolved.branchLengthsFixed ? 1 : 0,
          resolved.noReroot ? 1 : 0,
          treeSearchTypeId(resolved.treeSearchType),
          resolved.estimateMat ? 1 : 0,
        ),
      )
      return toInferenceResult(native)
    } finally {
      this.free(startingTree)
      this.free(startingAlignment)
    }
  }

  /** @internal Called by {@link MapleAlignment}. */
  inferLoaded(handle: number, options: InferenceOptions): InferenceResult {
    const resolved = resolveInferenceOptions(options)
    const startingTreeBytes = textEncoder.encode(resolved.startingTree)
    const startingAlignmentBytes = textEncoder.encode(resolved.startingAlignment)
    const startingTree = this.allocate(startingTreeBytes)
    const startingAlignment = this.allocate(startingAlignmentBytes)

    try {
      const native = this.callResult<NativeResult>('result', () =>
        this.module._cmaple_infer_loaded(
          handle,
          resolved.numThreads,
          substitutionModelId(resolved.substitutionModel),
          branchSupportMethodId(resolved.branchSupportMethod),
          resolved.branchSupportReplicates,
          resolved.branchSupportEpsilon,
          resolved.filterDivergentSamples ? 1 : 0,
          resolved.maxDivergencePercent,
          resolved.constantSites.a,
          resolved.constantSites.c,
          resolved.constantSites.g,
          resolved.constantSites.t,
          startingTree,
          startingTreeBytes.byteLength,
          startingAlignment,
          startingAlignmentBytes.byteLength,
          resolved.branchLengthsFixed ? 1 : 0,
          resolved.noReroot ? 1 : 0,
          treeSearchTypeId(resolved.treeSearchType),
          resolved.estimateMat ? 1 : 0,
        ),
      )
      return toInferenceResult(native)
    } finally {
      this.free(startingTree)
      this.free(startingAlignment)
    }
  }

  /** @internal Called by {@link MapleAlignment}. */
  summarize(handle: number, options: WarningSummaryOptions = {}): AlignmentWarningSummary {
    const resolved = resolveWarningSummaryOptions(options)
    return this.callResult<NativeWarningSummary>('warning-summary', () =>
      this.module._cmaple_warning_summary(
        handle,
        resolved.filterDivergentSamples ? 1 : 0,
        resolved.maxDivergencePercent,
        resolved.constantSites.a,
        resolved.constantSites.c,
        resolved.constantSites.g,
        resolved.constantSites.t,
      ),
    ).warningSummary
  }

  /** @internal Called by {@link MapleAlignment}. */
  exportMaple(handle: number): string {
    return this.callResult<NativeMapleExport>('maple-export', () =>
      this.module._cmaple_export_maple(handle),
    ).maple
  }

  /** @internal Called by {@link MapleAlignment.dispose}. */
  release(handle: number): void {
    this.module._cmaple_release(handle)
  }

  private allocate(bytes: Uint8Array): number {
    if (bytes.byteLength === 0) return 0
    const ptr = this.module._cmaple_alloc(bytes.byteLength)
    if (ptr === 0) {
      throw new MapleError(`Could not allocate ${bytes.byteLength} bytes of WebAssembly memory.`)
    }
    this.module.HEAPU8.set(bytes, ptr)
    return ptr
  }

  private free(ptr: number): void {
    if (ptr !== 0) this.module._cmaple_free(ptr)
  }

  private callWithInput<T extends { type: string }>(
    data: Uint8Array,
    expected: T['type'],
    callback: (ptr: number, size: number) => number,
  ): T {
    const ptr = this.allocate(data)
    let resultPtr = 0
    try {
      resultPtr = callback(ptr, data.byteLength)
    } finally {
      this.free(ptr)
    }
    return this.decodeResult<T>(resultPtr, expected)
  }

  private callResult<T extends { type: string }>(
    expected: T['type'],
    callback: () => number,
  ): T {
    return this.decodeResult<T>(callback(), expected)
  }

  private decodeResult<T extends { type: string }>(resultPtr: number, expected: T['type']): T {
    if (resultPtr === 0) {
      throw new MapleError('CMAPLE did not return a result.')
    }
    try {
      return parseNative<T>(readCString(this.module.HEAPU8, resultPtr), expected)
    } finally {
      this.free(resultPtr)
    }
  }
}

function toInferenceResult(native: NativeResult): InferenceResult {
  return {
    newick: native.newick,
    nexus: native.nexus ?? '',
    logLikelihood: native.logLikelihood,
    effective: native.effective,
    warnings: native.warnings,
  }
}
