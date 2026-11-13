![SYRUP logo](./public/logo.png)

SYRUP is a browser-based application for privacy-preserving, installation-free phylogenetic inference with [CMAPLE](https://academic.oup.com/mbe/article/41/7/msae134/7700168). It brings likelihood-based analysis of closely related pathogen genomes to the web by running CMAPLE through WebAssembly, so users can load an alignment, check whether it is suitable for CMAPLE, infer a tree, and inspect the result without uploading data to a server.

- App: [https://syrup.cpg.org.au](https://syrup.cpg.org.au/)
- Documentation: [docs](https://syrup.cpg.org.au/docs/)
- Maple WASM library: [npm](https://www.npmjs.com/package/@wytamma/maple-wasm) · [docs](https://syrup.cpg.org.au/docs/maple-wasm/)
- CMAPLE manual: [IQ-TREE CMAPLE user manual](https://github.com/iqtree/cmaple/wiki/User-Manual)

## Features

- Accepts aligned FASTA, PHYLIP, and MAPLE files.
- Performs preflight checks for sequence count, alignment length, variable columns, and CMAPLE suitability.
- Runs maximum likelihood-based CMAPLE inference in the browser using WebAssembly.
- Supports configurable threaded CMAPLE inference when the browser provides cross-origin isolation.
- Supports branch support settings, starting trees, sample filtering, constant-site counts, and MAPLE export.
- Renders inferred trees interactively and supports Newick copy/download.
- Sends a saved tree and its MAPLE alignment to MicrobeTrace from the tree library through its partner embed SDK.
- Keeps alignment and tree files local to the user's browser.

## Technology

SYRUP is built with Svelte, Vite, TypeScript, and a WebAssembly build of CMAPLE.

## Development

### Install dependencies

```bash
npm install
```

### Start the app locally

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

## WASM development

The WebAssembly artifacts are built via `pixi` and the helper scripts in [scripts](scripts).

### Rebuild the CMAPLE WASM bundle

```bash
npm run build:wasm
```

The build writes `public/cmaple-threaded.js` and `public/cmaple-threaded.wasm`.
The `@wytamma/maple-wasm` package copies those artifacts into its `dist` during
its own build.

### npm package

The WASM runtime and its typed wrapper live in
[`packages/maple-wasm`](packages/maple-wasm) and are published to npm as
`@wytamma/maple-wasm`. The app consumes the package through an npm workspace,
so build the package before type-checking, running the dev server, or building
the app (`npm run build:lib`, which those scripts already do).

```bash
npm run build:lib   # compile the package and copy the WASM artifacts
npm run test:lib    # package unit tests
npm run smoke:lib   # Playwright smoke test against the built package
```

Publishing to npm is tokenless. `.github/workflows/publish-wasm-package.yml`
uses npm trusted publishing: GitHub's OIDC identity is exchanged for a
short-lived publish token, and npm generates provenance automatically. It runs
on `maple-wasm-v*` tags or manual dispatch. No `NPM_TOKEN` secret is needed.

### Available `pixi` tasks

- `pixi run install-binaryen`
- `pixi run build-libomp`
- `pixi run build-wasm`

## Hosting notes

Threaded WASM requires cross-origin isolation headers:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Local development and `vite preview` provide these headers. If you deploy to another host, that host must also send them for threaded execution to work.

The tree library at `/trees.html` is the exception: it must be served **without** `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy`. That page holds a live handle on the tabEE receiving window (the Clockor2 and Trakka sends) and loads the MicrobeTrace SDK, neither of which survives an opener handle. `public/_headers` encodes this for Cloudflare Pages and Workers static assets: isolation on `/*`, detached for `/trees.html`. Hosts that cannot send per-path headers (GitHub Pages, for example) cannot host these features.

With MicrobeTrace running on `http://localhost:4200` and Syrup running on
`http://localhost:5173`, verify the complete browser handoff with:

```bash
npm run test:microbetrace-integration
```
