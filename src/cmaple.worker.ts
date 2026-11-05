import {
  MapleAlignment,
  MapleError,
  MapleRuntime,
  sanitizeConstantSites,
} from '@wytamma/maple-wasm'
import type {
  AlignmentFormat,
  AlignmentStats,
  AlignmentWarningSummary,
  ConstantSiteCounts,
  DivergenceSummary,
} from '@wytamma/maple-wasm'
import type { CmapleWorkerRequest, CmapleWorkerResponse } from './types/cmaple'

type StoredAlignment = {
  fileName: string
  format: AlignmentFormat
  fileSize: number
  alignment?: MapleAlignment
  stats?: AlignmentStats
  effective?: boolean
}

let runtimePromise: Promise<MapleRuntime> | null = null
let runtimeLoadMs: number | null = null
const alignments = new Map<string, StoredAlignment>()

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

function heapMiB(runtime: MapleRuntime) {
  return bytesToMiB(runtime.heapSize)
}

function bench(id: string | undefined, message: string) {
  console.info(`[CMAPLE bench] ${id ? `id=${id} ` : ''}${message}`)
}

function getObservedWarningColumnCount(summary: AlignmentWarningSummary, _stats: AlignmentStats) {
  return summary.variableColumns + Math.ceil(summary.meanAmbiguousSites)
}

function getLikelyLongRunWarning(summary: AlignmentWarningSummary, stats: AlignmentStats) {
  const observedColumnCount = getObservedWarningColumnCount(summary, stats)
  const largeAlignmentWarning =
    summary.sequenceCount * observedColumnCount >= 50_000_000
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

function loadRuntime(): Promise<MapleRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const startedAt = performance.now()
      if (!self.crossOriginIsolated) {
        throw new MapleError(
          'Threaded WASM requires cross-origin isolation headers (Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp).',
        )
      }

      try {
        const runtime = await MapleRuntime.load({
          onStdout: (message) => post({ type: 'log', message, stream: 'stdout' }),
          onStderr: (message) => post({ type: 'log', message, stream: 'stderr' }),
        })
        runtimeLoadMs = performance.now() - startedAt
        return runtime
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : 'CMAPLE Emscripten runtime could not be loaded.')
      }
    })()
    void runtimePromise.catch(() => {
      runtimePromise = null
    })
  }

  return runtimePromise
}

self.onmessage = async (event: MessageEvent<CmapleWorkerRequest>) => {
  const message = event.data
  const requestStartedAt = performance.now()

  try {
    if (message.type === 'clear') {
      const stored = alignments.get(message.id)
      alignments.delete(message.id)
      stored?.alignment?.dispose()
      return
    }

    const runtime = await loadRuntime()
    const runtimeReadyMs = performance.now() - requestStartedAt

    if (message.type === 'load') {
      alignments.get(message.id)?.alignment?.dispose()
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
          `heapMiB=${heapMiB(runtime)}`,
        ].join(' '),
      )

      const analyzeStartedAt = performance.now()
      const alignment = runtime.parse(message.data, {
        format: message.format,
        fileName: message.fileName,
      })
      const analyzeMs = performance.now() - analyzeStartedAt

      stored.alignment = alignment
      stored.stats = alignment.stats
      stored.effective = alignment.effective

      const warnings = [...alignment.warnings]
      const longRunWarning = getLikelyLongRunWarning(alignment.warningSummary, alignment.stats)
      if (longRunWarning) warnings.push(longRunWarning)

      bench(
        message.id,
        [
          'preflight.done',
          `analyzeMs=${ms(analyzeMs)}`,
          `nativeMs=${ms(analyzeMs)}`,
          `totalMs=${ms(performance.now() - requestStartedAt)}`,
          `heapMiB=${heapMiB(runtime)}`,
          `detectedFormat=${alignment.stats.format}`,
          `sequenceCount=${alignment.stats.sequenceCount}`,
          `sequenceLength=${alignment.stats.sequenceLength}`,
          `effective=${alignment.effective}`,
        ].join(' '),
      )

      post({
        type: 'preflight',
        id: message.id,
        stats: alignment.stats,
        effective: alignment.effective,
        warnings,
        divergence: alignment.divergence,
        warningSummary: alignment.warningSummary,
      })
      return
    }

    const stored = alignments.get(message.id)
    if (!stored) throw new Error('No alignment is loaded. Drop the file again.')
    if (!stored.alignment) throw new Error('The parsed alignment is unavailable. Drop the file again.')

    if (message.type === 'summarize-filter') {
      const constantSites = sanitizeConstantSites(message.constantSites)
      const summaryStartedAt = performance.now()
      const warningSummary = stored.alignment.summarize({
        filterDivergentSamples: message.filterDivergentSamples,
        maxDivergencePercent: message.maxDivergencePercent,
        constantSites,
      })
      bench(
        message.id,
        [
          'summary.done',
          `summaryMs=${ms(performance.now() - summaryStartedAt)}`,
          `filter=${message.filterDivergentSamples}`,
          `maxDivergencePercent=${message.maxDivergencePercent}`,
          `constantSites=${Object.values(constantSites).join(',')}`,
          `sequenceCount=${warningSummary.sequenceCount}`,
          `removedCount=${warningSummary.removedCount}`,
        ].join(' '),
      )
      post({ type: 'warning-summary', id: message.id, warningSummary })
      return
    }

    if (message.type === 'export-maple') {
      const exportStartedAt = performance.now()
      const maple = stored.alignment.exportMaple()
      bench(
        message.id,
        [
          'maple-export.done',
          `exportMs=${ms(performance.now() - exportStartedAt)}`,
          `mapleChars=${maple.length}`,
          `heapMiB=${heapMiB(runtime)}`,
        ].join(' '),
      )
      post({ type: 'maple-export', id: message.id, maple })
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
        `wasmHandle=${stored.alignment.handle}`,
        `detectedFormat=${stored.stats?.format ?? 'unknown'}`,
        `sequenceCount=${stored.stats?.sequenceCount ?? 'unknown'}`,
        `sequenceLength=${stored.stats?.sequenceLength ?? 'unknown'}`,
        `effective=${stored.effective ?? 'unknown'}`,
        `requestedThreads=${message.numThreads}`,
        `substitutionModel=${message.substitutionModel}`,
        `branchSupportMethod=${message.branchSupportMethod}`,
        `branchSupportReplicates=${message.branchSupportReplicates}`,
        `branchSupportEpsilon=${message.branchSupportEpsilon}`,
        `divergenceFilter=${message.filterDivergentSamples}`,
        `maxDivergencePercent=${message.maxDivergencePercent}`,
        `constantSites=${Object.values(constantSites).join(',')}`,
        `startingTree=${message.startingTreeText ? 'true' : 'false'}`,
        `startingAlignment=${message.startingAlignmentText ? 'true' : 'false'}`,
        `branchLengthsFixed=${message.branchLengthsFixed}`,
        `noReroot=${message.noReroot}`,
        `treeSearchType=${message.treeSearchType}`,
        `estimateMat=${message.estimateMat}`,
        `cpus=${navigator.hardwareConcurrency || 'unknown'}`,
        `crossOriginIsolated=${crossOriginIsolated}`,
        `runtimeReadyMs=${ms(runtimeReadyMs)}`,
        `heapMiB=${heapMiB(runtime)}`,
      ].join(' '),
    )

    const inferStartedAt = performance.now()
    const result = stored.alignment.infer({
      numThreads: message.numThreads,
      substitutionModel: message.substitutionModel,
      branchSupportMethod: message.branchSupportMethod,
      branchSupportReplicates: message.branchSupportReplicates,
      branchSupportEpsilon: message.branchSupportEpsilon,
      filterDivergentSamples: message.filterDivergentSamples,
      maxDivergencePercent: message.maxDivergencePercent,
      constantSites,
      startingTree: message.startingTreeText,
      startingAlignment: message.startingAlignmentText,
      branchLengthsFixed: message.branchLengthsFixed,
      noReroot: message.noReroot,
      treeSearchType: message.treeSearchType,
      estimateMat: message.estimateMat,
    })

    bench(
      message.id,
      [
        'infer.done',
        `inferMs=${ms(performance.now() - inferStartedAt)}`,
        `totalMs=${ms(performance.now() - requestStartedAt)}`,
        `heapMiB=${heapMiB(runtime)}`,
        `logLikelihood=${result.logLikelihood}`,
        `newickChars=${result.newick.length}`,
        `nexusChars=${result.nexus?.length ?? 0}`,
      ].join(' '),
    )

    post({ type: 'result', id: message.id, ...result })
  } catch (err) {
    post({
      type: 'error',
      id: 'id' in message ? message.id : undefined,
      error: err instanceof Error ? err.message : 'CMAPLE inference failed.',
    })
  }
}
