![SYRUP logo](./public/logo.png)

SYRUP is a browser-based phylogenetics app built with Svelte, Vite, TypeScript, and a WebAssembly build of [CMAPLE](https://academic.oup.com/mbe/article/41/7/msae134/7700168).

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

## Project structure

- [src](src) — application source
- [public](public) — static assets copied as-is
- [scripts](scripts) — WASM/toolchain helper scripts
- [wasm](wasm) — CMAPLE WASM source/build inputs
- [vendor/cmaple](vendor/cmaple) — vendored CMAPLE source
- [build](build) — local build artifacts and external toolchain output
