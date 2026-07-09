![SYRUP logo](./public/logo.png)

SYRUP is a browser-based application for privacy-preserving, installation-free phylogenetic inference with [CMAPLE](https://academic.oup.com/mbe/article/41/7/msae134/7700168). It brings likelihood-based analysis of closely related pathogen genomes to the web by running CMAPLE through WebAssembly, so users can load an alignment, check whether it is suitable for CMAPLE, infer a tree, and inspect the result without uploading data to a server.

- App: [https://syrup.cpg.org.au](https://syrup.cpg.org.au/)
- Documentation: [docs](https://syrup.cpg.org.au/docs/)
- CMAPLE manual: [IQ-TREE CMAPLE user manual](https://github.com/iqtree/cmaple/wiki/User-Manual)

## Features

- Accepts aligned FASTA, PHYLIP, and MAPLE files.
- Performs preflight checks for sequence count, alignment length, variable columns, and CMAPLE suitability.
- Runs maximum likelihood-based CMAPLE inference in the browser using WebAssembly.
- Supports branch support settings, starting trees, sample filtering, constant-site counts, and MAPLE export.
- Renders inferred trees interactively and supports Newick copy/download.
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

### Available `pixi` tasks

- `pixi run install-binaryen`
- `pixi run build-libomp`
- `pixi run build-wasm`

## Hosting notes

Threaded WASM requires cross-origin isolation headers:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Local development and `vite preview` provide these headers. If you deploy to another host, that host must also send them for threaded execution to work.