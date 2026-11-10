# Maple WASM

[![npm](https://img.shields.io/npm/v/@wytamma/maple-wasm?label=%40wytamma%2Fmaple-wasm)](https://www.npmjs.com/package/@wytamma/maple-wasm)

`@wytamma/maple-wasm` exposes the same CMAPLE engine that powers Syrup as a
threaded WebAssembly runtime with a typed TypeScript API. Use it to run
maximum-likelihood inference inside another browser application or Web Worker
without installing command-line software or uploading alignments.

- npm: <https://www.npmjs.com/package/@wytamma/maple-wasm>
- source: [`packages/maple-wasm`](https://github.com/Wytamma/syrup/tree/main/packages/maple-wasm)
- license: GPL-2.0-only

## Install

```sh
npm install @wytamma/maple-wasm
```

## Requirements

- A browser with `SharedArrayBuffer` support. The page and any worker that runs
  CMAPLE must be cross-origin isolated:

  ```http
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

- The Emscripten build targets browsers and Web Workers. It does not run in
  Node.js.
- The WebAssembly heap is fixed at 2 GiB. Alignments that do not fit fail with
  a `MapleError`.
- All inference methods are synchronous and block the calling thread. Run them
  in a dedicated Web Worker for anything larger than a toy alignment.

## Quick start

```ts
import { MapleRuntime } from '@wytamma/maple-wasm'

const runtime = await MapleRuntime.load()

const bytes = new Uint8Array(await file.arrayBuffer())
const alignment = runtime.parse(bytes, {
  format: 'auto',
  fileName: file.name,
})

console.log(alignment.stats.sequenceCount, alignment.stats.sequenceLength)
console.log(alignment.warningSummary.variableColumns)

const result = alignment.infer({
  numThreads: 4,
  substitutionModel: 'GTR',
  branchSupportMethod: 'none',
})

console.log(result.newick)
console.log(result.logLikelihood)

alignment.dispose()
```

`runtime.parse()` keeps the parsed alignment in WebAssembly memory so repeated
inference runs do not re-parse the file. Call `alignment.dispose()` when it is
no longer needed; the C++ runtime has no finalisation hooks.

## Parsed alignments

`runtime.parse()` returns a `MapleAlignment` with the preflight information:

| Field | Description |
| --- | --- |
| `stats` | File name, size, detected format, sequence type, sample names, sequence count and length. |
| `effective` | Whether the alignment is expected to suit CMAPLE. |
| `warnings` | Preflight warnings from CMAPLE. |
| `divergence` | Sample divergence scores and CMAPLE mutation counts. |
| `warningSummary` | Variable columns, ambiguous sites, filtered-out count, and related statistics. |
| `handle` | Native alignment handle. |
| `isDisposed` | Whether `dispose()` has been called. |

`summarize()` recomputes the warning summary without re-parsing:

```ts
const summary = alignment.summarize({
  filterDivergentSamples: true,
  maxDivergencePercent: 6.7,
  constantSites: { a: 0, c: 0, g: 0, t: 0 },
})
```

`exportMaple()` returns the retained alignment in MAPLE format.

## One-shot inference

```ts
const result = runtime.infer(bytes, { format: 'fasta', numThreads: 2 })
```

This parses and infers in one native call and does not retain the alignment. It
accepts the same options as `alignment.infer()` plus `format`.

## Workers

Inference blocks the calling thread, so a worker is the normal deployment:

```ts
// maple.worker.ts
import {
  MapleRuntime,
  type InferenceOptions,
  type MapleAlignment,
} from '@wytamma/maple-wasm'

const runtime = await MapleRuntime.load()
let alignment: MapleAlignment | undefined

self.onmessage = (event: MessageEvent) => {
  const message = event.data

  if (message.type === 'parse') {
    alignment?.dispose()
    alignment = runtime.parse(new Uint8Array(message.buffer), {
      format: 'auto',
      fileName: message.fileName,
    })
    self.postMessage({ type: 'parsed', stats: alignment.stats })
    return
  }

  if (message.type === 'infer') {
    if (!alignment) throw new Error('Parse an alignment first.')
    const result = alignment.infer(message.options as InferenceOptions)
    self.postMessage({ type: 'result', result })
    return
  }

  if (message.type === 'dispose') {
    alignment?.dispose()
    alignment = undefined
  }
}
```

```ts
const worker = new Worker(new URL('./maple.worker.ts', import.meta.url), {
  type: 'module',
})
```

Transfer the alignment buffer instead of copying it:

```ts
worker.postMessage({ type: 'parse', fileName, buffer }, [buffer])
```

The document must still be cross-origin isolated for the runtime's thread pool
to start.

## API

### `MapleRuntime`

| Member | Returns | Description |
| --- | --- | --- |
| `MapleRuntime.load(options?)` | `Promise<MapleRuntime>` | Loads the singleton runtime for the tab/worker. |
| `runtime.parse(data, options?)` | `MapleAlignment` | Parses and retains an alignment. |
| `runtime.infer(data, options?)` | `InferenceResult` | Parses and infers in one call. |
| `runtime.heapSize` | `number` | Current WebAssembly heap size in bytes. |

### `MapleAlignment`

| Member | Returns | Description |
| --- | --- | --- |
| `infer(options?)` | `InferenceResult` | Infers a tree from the retained alignment. |
| `summarize(options?)` | `AlignmentWarningSummary` | Recomputes filter-sensitive statistics. |
| `exportMaple()` | `string` | Exports the retained alignment in MAPLE format. |
| `dispose()` | `void` | Releases the native alignment. Safe to call repeatedly. |

### Inference options

| Option | Default | Description |
| --- | --- | --- |
| `numThreads` | half of `navigator.hardwareConcurrency` | CMAPLE worker threads. |
| `substitutionModel` | `GTR` | DNA or protein substitution model. |
| `branchSupportMethod` | `sprta` | `none`, `sprta`, or `sh-alrt`. |
| `branchSupportReplicates` | `1000` | Replicates for SPRTA or SH-aLRT. |
| `branchSupportEpsilon` | `0.1` | Branch support epsilon. |
| `filterDivergentSamples` | `false` | Remove divergent samples before inference. |
| `maxDivergencePercent` | `6.7` | Divergence filter threshold. |
| `constantSites` | all zeroes | Constant A/C/G/T counts for DNA alignments. |
| `startingTree` | none | Newick starting tree text. |
| `startingAlignment` | none | MAPLE starting alignment text. |
| `branchLengthsFixed` | `false` | Keep starting branch lengths fixed. |
| `noReroot` | `false` | Skip root optimisation. |
| `treeSearchType` | `normal` | `fast`, `normal`, or `exhaustive`. |
| `estimateMat` | `false` | Estimate a mutation-annotated tree. |

`InferenceResult` contains `newick`, `nexus`, `logLikelihood`, `effective`, and
`warnings`.

### Runtime options

| Option | Default | Description |
| --- | --- | --- |
| `wasmUrl` | packaged `cmaple-threaded.wasm` | Custom WASM asset URL. |
| `scriptUrl` | packaged `cmaple-threaded.js` | Custom Emscripten runtime URL. |
| `onStdout` | no-op | Receives CMAPLE stdout. |
| `onStderr` | no-op | Receives CMAPLE stderr. |
| `requireCrossOriginIsolation` | `true` | Refuse to start without COOP/COEP. |

## Formats and models

Alignment formats are `auto`, `fasta`, `phylip`, and `maple`. DNA models
include `GTR`, `JC`, and `UNREST`. Protein models include `LG`, `WAG`, `JTT`,
`GTR20`, `NONREV`, the empirical `Q.*`/`NQ.*` matrices, and the remaining
CMAPLE model set (`BLOSUM62`, `DAYHOFF`, `MTREV`, `HIVB`, `FLU`, and others).
Protein alignments must pass a protein substitution model explicitly; the
default is `GTR`.

The exported TypeScript unions (`SubstitutionModel`, `BranchSupportMethod`,
`TreeSearchType`, `AlignmentFormat`) enumerate every accepted value.

## Bundlers and asset hosting

The package resolves its assets with `new URL('./cmaple-threaded.*',
import.meta.url)`. With Vite, keep the package out of dependency prebundling:

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    exclude: ['@wytamma/maple-wasm'],
  },
})
```

To serve the runtime from a CDN or another path, pass `wasmUrl` and
`scriptUrl` to `MapleRuntime.load()`.

## Errors

Native failures, invalid usage, allocation failures, and using a disposed
alignment throw `MapleError` with the original CMAPLE message where available.

```ts
import { MapleError, MapleRuntime } from '@wytamma/maple-wasm'

try {
  const runtime = await MapleRuntime.load()
  runtime.parse(bytes)
} catch (error) {
  if (error instanceof MapleError) console.error(error.message)
}
```

## Development

From the Syrup repository:

```bash
npm run build:wasm   # rebuild public/cmaple-threaded.{js,wasm} (pixi + Emscripten)
npm run build:lib    # compile the package and copy the WASM artifacts
npm run test:lib     # package unit tests
npm run smoke:lib    # Playwright smoke test against the built package
```

Releases are published from GitHub Actions with npm trusted publishing when a
`maple-wasm-v*` tag matches the version in `packages/maple-wasm/package.json`.

## License

`@wytamma/maple-wasm` is distributed under GPL-2.0-only because it embeds a
compiled copy of [CMAPLE](https://github.com/iqtree/cmaple), which is GPL-2.0.
