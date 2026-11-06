#!/usr/bin/env node
/**
 * Run one inference with the published @wytamma/maple-wasm package.
 *
 * The package targets the browser, so this runner serves its dist directory
 * and the alignment over a cross-origin-isolated local HTTP server, launches
 * headless Chrome (no automation library), and collects the result the page
 * POSTs back. Chrome is killed once the result arrives or the timeout fires.
 */

import { createServer } from 'node:http'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH_ROOT = dirname(fileURLToPath(import.meta.url))
const PACKAGE_NAME = '@wytamma/maple-wasm'
const PACKAGE_DIR = join(BENCH_ROOT, 'node_modules', PACKAGE_NAME)
const DIST_DIR = join(PACKAGE_DIR, 'dist')

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

function parseArgs(argv) {
  const args = {
    dataset: '',
    threads: 1,
    format: 'auto',
    branchSupport: 'none',
    branchSupportReplicates: 1000,
    treeSearch: 'normal',
    outJson: '',
    outNewick: '',
    timeoutSeconds: 3600,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => {
      i += 1
      if (i >= argv.length) throw new Error(`Missing value for ${flag}`)
      return argv[i]
    }
    switch (flag) {
      case '--dataset': args.dataset = resolve(next()); break
      case '--threads': args.threads = Number(next()); break
      case '--format': args.format = next(); break
      case '--branch-support': args.branchSupport = next(); break
      case '--branch-support-replicates': args.branchSupportReplicates = Number(next()); break
      case '--tree-search': args.treeSearch = next(); break
      case '--out-json': args.outJson = resolve(next()); break
      case '--out-newick': args.outNewick = resolve(next()); break
      case '--timeout-seconds': args.timeoutSeconds = Number(next()); break
      case '--help':
        console.log('Usage: node wasm_runner.mjs --dataset PATH --out-json PATH [...]')
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${flag}`)
    }
  }
  if (!args.dataset) throw new Error('--dataset is required')
  if (!args.outJson) throw new Error('--out-json is required')
  if (!Number.isInteger(args.threads) || args.threads < 1) {
    throw new Error('--threads must be a positive integer')
  }
  return args
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'Chrome/Chromium was not found. Set CHROME_BIN to a Chrome or Chromium executable.',
  )
}

function packageVersion() {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
  return manifest.version
}

function harnessHtml(config) {
  const configJson = JSON.stringify(config)
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>maple-wasm benchmark</title></head>
<body>
<script>window.__BENCH_CONFIG__ = ${configJson};</script>
<script type="module">
  const config = window.__BENCH_CONFIG__
  let posted = false
  const post = async (payload) => {
    if (posted) return
    posted = true
    const body = JSON.stringify(payload)
    // A long synchronous inference can outlive a keep-alive socket. Chrome
    // does not retry POSTs that hit a closed socket, so retry explicitly.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch('/result', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
        if (response.ok) return
      } catch {
        // Socket was closed; try again on a fresh connection.
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const mark = (stage) => fetch('/progress', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: stage,
  }).catch(() => {})
  const failure = (error) => post({
    ok: false,
    error: String((error && error.stack) || error),
  })
  addEventListener('error', (event) => failure(event.error || event.message))
  addEventListener('unhandledrejection', (event) => failure(event.reason))

  ;(async () => {
    await mark('start')
    const started = performance.now()
    const { MapleRuntime } = await import('/dist/index.js')
    await mark('imported')
    const runtime = await MapleRuntime.load({ requireCrossOriginIsolation: true })
    await mark('runtime-loaded')
    const loadMs = performance.now() - started

    const response = await fetch('/dataset', { cache: 'no-store' })
    if (!response.ok) throw new Error(\`dataset fetch failed: \${response.status}\`)
    const data = new Uint8Array(await response.arrayBuffer())
    await mark('dataset-fetched')

    const parseStarted = performance.now()
    const alignment = runtime.parse(data, {
      format: config.format,
      fileName: config.fileName,
    })
    const parseMs = performance.now() - parseStarted
    await mark('parsed')

    const inferStarted = performance.now()
    const result = alignment.infer({
      numThreads: config.threads,
      substitutionModel: config.substitutionModel,
      branchSupportMethod: config.branchSupportMethod,
      branchSupportReplicates: config.branchSupportReplicates,
      treeSearchType: config.treeSearchType,
      filterDivergentSamples: false,
    })
    const inferMs = performance.now() - inferStarted
    await mark('inferred')

    const payload = {
      ok: true,
      stats: alignment.stats,
      divergence: alignment.divergence,
      warningSummary: alignment.warningSummary,
      logLikelihood: result.logLikelihood,
      newick: result.newick,
      runtimeLoadMs: loadMs,
      parseMs,
      inferMs,
      totalMs: performance.now() - started,
      heapMiB: runtime.heapSize / 1024 / 1024,
      hardwareConcurrency: navigator.hardwareConcurrency,
      crossOriginIsolated: globalThis.crossOriginIsolated,
    }
    alignment.dispose()
    await post(payload)
  })().catch(failure)
</script>
</body>
</html>`
}

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!existsSync(join(DIST_DIR, 'index.js'))) {
    throw new Error(
      `Package assets not found in ${DIST_DIR}. Run \`npm install\` in ${BENCH_ROOT}.`,
    )
  }
  const chrome = findChrome()
  const chromeVersion = execFileSync(chrome, ['--version'], { encoding: 'utf8' }).trim()
  const version = packageVersion()
  const dataset = await readFile(args.dataset)

  let resolveResult
  let rejectResult
  const resultPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveResult = resolvePromise
    rejectResult = rejectPromise
  })

  const server = createServer(async (request, response) => {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    response.setHeader('Cache-Control', 'no-store')

    console.error(`[harness] ${request.method} ${request.url}`)

    if (request.method === 'POST' && request.url === '/progress') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      response.end('ok')
      console.error(`[page] ${Buffer.concat(chunks).toString('utf8')}`)
      return
    }

    if (request.method === 'POST' && request.url === '/result') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      response.end('ok')
      try {
        resolveResult(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        rejectResult(error)
      }
      return
    }

    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(
        harnessHtml({
          fileName: args.dataset.split('/').pop(),
          threads: args.threads,
          format: args.format,
          substitutionModel: 'GTR',
          branchSupportMethod: args.branchSupport,
          branchSupportReplicates: args.branchSupportReplicates,
          treeSearchType: args.treeSearch,
        }),
      )
      return
    }

    if (request.url === '/dataset') {
      response.setHeader('Content-Type', 'application/octet-stream')
      response.end(dataset)
      return
    }

    if (request.url === '/favicon.ico') {
      response.statusCode = 204
      response.end()
      return
    }

    if (request.url.startsWith('/dist/')) {
      const relative = normalize(request.url.slice('/dist/'.length))
      if (relative.startsWith('..')) {
        response.statusCode = 400
        response.end('bad path')
        return
      }
      try {
        const file = await readFile(join(DIST_DIR, relative))
        const extension = relative.slice(relative.lastIndexOf('.'))
        response.setHeader(
          'Content-Type',
          CONTENT_TYPES[extension] ?? 'application/octet-stream',
        )
        response.end(file)
      } catch {
        response.statusCode = 404
        response.end('not found')
      }
      return
    }

    response.statusCode = 404
    response.end('not found')
  })

  // Inference blocks the page longer than the default 5 s keep-alive timeout.
  server.keepAliveTimeout = 0
  server.headersTimeout = 0
  server.requestTimeout = 0

  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const { port } = server.address()
  const profileDir = await mkdtemp(join(tmpdir(), 'syrup-benchmark-'))
  const launchedAt = Date.now()

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-dev-shm-usage',
      `--user-data-dir=${profileDir}`,
      `http://127.0.0.1:${port}/`,
    ],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  )

  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    if (stderr.length > 16_384) stderr = stderr.slice(-16_384)
  })
  child.on('error', (error) => {
    rejectResult(new Error(`Could not launch Chrome: ${error.message}`))
  })
  child.on('exit', (code, signal) => {
    rejectResult(new Error(`Chrome exited before returning a result (code=${code}, signal=${signal})`))
  })

  const killChrome = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
  }

  const timer = setTimeout(
    () => rejectResult(new Error(`Timed out after ${args.timeoutSeconds}s`)),
    args.timeoutSeconds * 1000,
  )

  let payload
  try {
    payload = await resultPromise
  } finally {
    clearTimeout(timer)
    killChrome()
    server.close()
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }

  if (!payload.ok) {
    throw new Error(`maple-wasm run failed: ${payload.error}\n${stderr}`)
  }

  const metrics = {
    tool: 'wasm',
    package: PACKAGE_NAME,
    package_version: version,
    chrome_version: chromeVersion,
    dataset: args.dataset,
    threads: args.threads,
    format: args.format,
    branch_support: args.branchSupport,
    branch_support_replicates: args.branchSupportReplicates,
    tree_search: args.treeSearch,
    status: 'ok',
    wall_seconds: (Date.now() - launchedAt) / 1000,
    runtime_load_ms: payload.runtimeLoadMs,
    parse_ms: payload.parseMs,
    infer_ms: payload.inferMs,
    total_ms: payload.totalMs,
    log_likelihood: payload.logLikelihood,
    newick_chars: payload.newick.length,
    stats: payload.stats,
    divergence: payload.divergence,
    warning_summary: payload.warningSummary,
    heap_mib: payload.heapMiB,
    hardware_concurrency: payload.hardwareConcurrency,
    cross_origin_isolated: payload.crossOriginIsolated,
  }

  await mkdir(dirname(args.outJson), { recursive: true })
  await writeFile(args.outJson, JSON.stringify(metrics, null, 2) + '\n')
  if (args.outNewick) {
    await mkdir(dirname(args.outNewick), { recursive: true })
    await writeFile(args.outNewick, payload.newick + '\n')
  }

  console.log(
    JSON.stringify({
      ok: true,
      dataset: args.dataset,
      threads: args.threads,
      infer_ms: metrics.infer_ms,
      log_likelihood: metrics.log_likelihood,
    }),
  )
}

main().catch(async (error) => {
  console.error(`WASM_RUNNER_ERROR: ${error.message}`)
  process.exitCode = 1
})
