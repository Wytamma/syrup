import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Connect, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// Cross-origin isolation unlocks threaded WASM. `/trees.html` must stay outside
// it so the page can keep a tabEE receiving window's handle.
const TREE_LIBRARY_PATH = '/trees.html'

function perPathIsolationHeaders(): Plugin {
  const applyIsolationHeaders: Connect.NextHandleFunction = (req, res, next) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/'
    if (path !== TREE_LIBRARY_PATH) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    }
    next()
  }

  return {
    name: 'syrup-per-path-isolation-headers',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(applyIsolationHeaders)
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(applyIsolationHeaders)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [svelte(), perPathIsolationHeaders()],
  optimizeDeps: {
    // The package resolves its .wasm and Emscripten runtime relative to
    // import.meta.url, so it must be served unbundled in development.
    exclude: ['@wytamma/maple-wasm'],
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        trees: fileURLToPath(new URL('./trees.html', import.meta.url)),
      },
    },
  },
})
