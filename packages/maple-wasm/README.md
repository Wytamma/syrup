# @wytamma/maple-wasm

[CMAPLE](https://github.com/iqtree/cmaple) maximum-likelihood phylogenetic
inference compiled to threaded WebAssembly, with a typed TypeScript API.

The package ships the Emscripten runtime (`cmaple-threaded.js`), the
WebAssembly binary (`cmaple-threaded.wasm`), and a wrapper that owns WASM
memory, option normalisation, and native error handling.

## Install

```sh
npm install @wytamma/maple-wasm
```

## Requirements

- A browser with `SharedArrayBuffer` support. The page (or worker) must be
  cross-origin isolated. Serve it with:

  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

- The Emscripten build targets `web` and `worker`; it does not run in Node.
- The WASM heap is fixed at 2 GiB. Alignments that do not fit fail with a
  `MapleError` when allocated.

All inference methods are synchronous and block the calling thread. Use a
dedicated Web Worker for anything larger than a toy alignment.

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

`runtime.parse()` keeps the parsed alignment in WASM memory so repeated
inference runs do not re-parse the file. Call `alignment.dispose()` when it is
no longer needed; the C++ runtime has no finalisation hooks.

### One-shot inference

```ts
const result = runtime.infer(bytes, { format: 'fasta', numThreads: 2 })
```

This parses and infers in one native call and does not retain the alignment.

### Worker usage

```ts
// maple.worker.ts
import { MapleRuntime, type InferenceOptions } from '@wytamma/maple-wasm'

const runtime = await MapleRuntime.load()
let alignment: Awaited<ReturnType<typeof runtime.parse>> | undefined

self.onmessage = (event) => {
  if (event.data.type === 'parse') {
    alignment?.dispose()
    alignment = runtime.parse(event.data.bytes, { fileName: event.data.fileName })
    self.postMessage({ type: 'parsed', stats: alignment.stats })
  }

  if (event.data.type === 'infer') {
    const result = alignment!.infer(event.data.options satisfies InferenceOptions)
    self.postMessage({ type: 'result', result })
  }
}
```

```ts
const worker = new Worker(new URL('./maple.worker.ts', import.meta.url), {
  type: 'module',
})
```

The application must be cross-origin isolated for the worker's thread pool to
start.

## API

| Export | Purpose |
| --- | --- |
| `MapleRuntime.load(options?)` | Loads the singleton runtime. |
| `runtime.parse(data, options?)` | Parses an alignment and returns a `MapleAlignment`. |
| `runtime.infer(data, options?)` | One-shot parse and inference. |
| `alignment.infer(options?)` | Infers a tree, reusing the parsed alignment. |
| `alignment.summarize(options?)` | Recomputes the warning summary for different filters. |
| `alignment.exportMaple()` | Exports the retained alignment in MAPLE format. |
| `alignment.dispose()` | Releases the native alignment. |
| `MapleError` | Thrown for native errors and invalid usage. |

`MapleRuntime.load()` accepts:

| Option | Default | Description |
| --- | --- | --- |
| `wasmUrl` | packaged `cmaple-threaded.wasm` | Custom WASM asset URL. |
| `scriptUrl` | packaged `cmaple-threaded.js` | Custom Emscripten runtime URL. |
| `onStdout` | no-op | Receives CMAPLE stdout. |
| `onStderr` | no-op | Receives CMAPLE stderr. |
| `requireCrossOriginIsolation` | `true` | Refuse to start without COOP/COEP. |

Inference defaults: `numThreads` is half of `navigator.hardwareConcurrency`,
`substitutionModel` is `GTR`, branch support is `sprta` with 1000 replicates
and epsilon `0.1`, divergence filtering is off, and tree search is `normal`.
Protein alignments must pass a protein substitution model explicitly.

## Bundlers

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

To host the assets yourself, pass `wasmUrl` and `scriptUrl`.

## License

`@wytamma/maple-wasm` is distributed under GPL-2.0-only because it embeds a
compiled copy of CMAPLE, which is GPL-2.0. See `LICENSE`.
