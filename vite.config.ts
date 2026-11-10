import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

const isolationHeaders = (): Plugin => ({
  name: 'syrup-cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use(applyIsolationHeaders)
  },
  configurePreviewServer(server) {
    server.middlewares.use(applyIsolationHeaders)
  },
})

function applyIsolationHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  const pathname = new URL(request.url || '/', 'http://syrup.local').pathname
  const isMicrobeTraceBridge = pathname === '/microbetrace-export.html' || pathname === '/microbetrace-export.js'

  if (!isMicrobeTraceBridge) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  }
  next()
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [isolationHeaders(), svelte()],
  optimizeDeps: {
    // The package resolves its .wasm and Emscripten runtime relative to
    // import.meta.url, so it must be served unbundled in development.
    exclude: ['@wytamma/maple-wasm'],
  },
})
