# CMAPLE WASM

This directory contains the small browser-facing C ABI wrapper and generated
configuration header used to build CMAPLE v2.0.0 with Pixi-managed
Emscripten.

Run:

```sh
npm run build:wasm
```

The build writes `public/cmaple-threaded.js` and
`public/cmaple-threaded.wasm`, which are loaded by `src/cmaple.worker.ts`.
