import { MapleError } from './errors.js'
import type { MapleRuntime } from './runtime.js'
import type {
  AlignmentStats,
  AlignmentWarningSummary,
  DivergenceSummary,
  InferenceOptions,
  InferenceResult,
  Preflight,
  WarningSummaryOptions,
} from './types.js'

/**
 * A parsed CMAPLE alignment retained in WebAssembly memory.
 *
 * Call {@link dispose} when the alignment is no longer needed. The C++ runtime
 * has no finalisation hooks, so the memory is not released automatically.
 */
export class MapleAlignment {
  readonly handle: number
  readonly stats: AlignmentStats
  readonly effective: boolean
  readonly warnings: readonly string[]
  readonly divergence: DivergenceSummary
  readonly warningSummary: AlignmentWarningSummary

  private readonly runtime: MapleRuntime
  private disposed = false

  /** @internal Use {@link MapleRuntime.parse}. */
  constructor(runtime: MapleRuntime, preflight: Preflight & { handle: number }) {
    this.runtime = runtime
    this.handle = preflight.handle
    this.stats = preflight.stats
    this.effective = preflight.effective
    this.warnings = preflight.warnings
    this.divergence = preflight.divergence
    this.warningSummary = preflight.warningSummary
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Infers a tree from the retained alignment. Blocks until inference completes. */
  infer(options: InferenceOptions = {}): InferenceResult {
    this.assertActive()
    return this.runtime.inferLoaded(this.handle, options)
  }

  /** Recomputes the warning summary for different quality-filter settings. */
  summarize(options: WarningSummaryOptions = {}): AlignmentWarningSummary {
    this.assertActive()
    return this.runtime.summarize(this.handle, options)
  }

  /** Exports the retained alignment in MAPLE format. */
  exportMaple(): string {
    this.assertActive()
    return this.runtime.exportMaple(this.handle)
  }

  /** Releases the alignment from WebAssembly memory. Safe to call repeatedly. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.runtime.release(this.handle)
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new MapleError('This alignment has been disposed. Parse the data again to use it.')
    }
  }
}
