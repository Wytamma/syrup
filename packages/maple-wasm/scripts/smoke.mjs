import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const dist = new URL('../dist/', import.meta.url)

function makeFasta() {
  let seed = 42
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const bases = 'ACGT'
  const length = 600
  const reference = Array.from({ length }, () => bases[Math.floor(random() * 4)]).join('')
  const sequences = [reference]
  for (let i = 1; i < 8; i += 1) {
    const sequence = [...reference]
    for (let mutation = 0; mutation < 60; mutation += 1) {
      const position = Math.floor(random() * length)
      sequence[position] = bases[Math.floor(random() * 4)]
    }
    sequences.push(sequence.join(''))
  }
  return `${sequences.map((sequence, index) => `>sample_${index}\n${sequence}`).join('\n')}\n`
}

const fasta = makeFasta()
const contentTypes = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.html': 'text/html',
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
  response.setHeader('Cache-Control', 'no-store')

  if (url.pathname === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><meta charset="utf-8"><title>maple-wasm smoke</title>')
    return
  }

  if (url.pathname === '/sample.fa') {
    response.setHeader('Content-Type', 'text/plain')
    response.end(fasta)
    return
  }

  try {
    const file = await readFile(new URL(`.${url.pathname}`, dist))
    const extension = url.pathname.slice(url.pathname.lastIndexOf('.'))
    response.setHeader('Content-Type', contentTypes[extension] ?? 'application/octet-stream')
    response.end(file)
  } catch {
    response.statusCode = 404
    response.end('not found')
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage()
  const browserMessages = []
  page.on('console', (message) => browserMessages.push(`${message.type()}: ${message.text()}`))
  page.on('pageerror', (error) => browserMessages.push(`pageerror: ${error.message}`))
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 4 })
  })
  await page.goto(`http://127.0.0.1:${port}/`)

  const result = await page.evaluate(async () => {
    const { MapleRuntime } = await import('/index.js')
    const response = await fetch('/sample.fa')
    const data = new Uint8Array(await response.arrayBuffer())

    const runtime = await MapleRuntime.load()
    const alignment = runtime.parse(data, { format: 'auto', fileName: 'sample.fa' })
    const summary = alignment.summarize({ filterDivergentSamples: true, maxDivergencePercent: 2 })
    const maple = alignment.exportMaple()
    const loaded = alignment.infer({
      numThreads: 2,
      branchSupportMethod: 'none',
      treeSearchType: 'fast',
    })

    const started = alignment.infer({
      numThreads: 2,
      branchSupportMethod: 'none',
      treeSearchType: 'fast',
      startingTree: loaded.newick,
    })

    const disposable = runtime.parse(data, { format: 'fasta' })
    disposable.dispose()
    let disposedError = ''
    try {
      disposable.infer({ branchSupportMethod: 'none' })
    } catch (error) {
      disposedError = error instanceof Error ? error.message : String(error)
    }

    const oneShot = runtime.infer(data, {
      format: 'fasta',
      numThreads: 2,
      branchSupportMethod: 'none',
      treeSearchType: 'fast',
    })

    alignment.dispose()

    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      stats: {
        format: alignment.stats.format,
        sequenceType: alignment.stats.sequenceType,
        sequenceCount: alignment.stats.sequenceCount,
        sequenceLength: alignment.stats.sequenceLength,
        fileName: alignment.stats.fileName,
        fileSize: alignment.stats.fileSize,
      },
      variableColumns: alignment.warningSummary.variableColumns,
      filteredSummary: {
        filterDivergentSamples: summary.filterDivergentSamples,
        maxDivergencePercent: summary.maxDivergencePercent,
        sequenceCount: summary.sequenceCount,
      },
      mapleLength: maple.length,
      mapleHasSamples: maple.includes('sample_0') && maple.includes('sample_7'),
      loaded: {
        newickLength: loaded.newick.length,
        newickStartsWithParen: loaded.newick.trimStart().startsWith('('),
        nexusLength: loaded.nexus.length,
        logLikelihood: loaded.logLikelihood,
      },
      started: {
        newickLength: started.newick.length,
        logLikelihood: started.logLikelihood,
      },
      disposedError,
      oneShot: {
        newickLength: oneShot.newick.length,
        logLikelihood: oneShot.logLikelihood,
      },
      heapMiB: runtime.heapSize / 1024 / 1024,
    }
  })

  const failures = []
  if (result.crossOriginIsolated !== true) failures.push('page is not cross-origin isolated')
  if (result.stats.format !== 'fasta') failures.push(`detected format ${result.stats.format}`)
  if (result.stats.sequenceCount !== 8) failures.push(`sequenceCount ${result.stats.sequenceCount}`)
  if (result.stats.sequenceLength !== 600) failures.push(`sequenceLength ${result.stats.sequenceLength}`)
  if (result.stats.fileName !== 'sample.fa') failures.push(`fileName ${result.stats.fileName}`)
  if (result.variableColumns <= 0) failures.push('no variable columns detected')
  if (!result.filteredSummary.filterDivergentSamples) failures.push('filter flag not reflected in summary')
  if (result.mapleLength <= 0 || !result.mapleHasSamples) failures.push('MAPLE export is invalid')
  if (result.loaded.newickLength <= 0 || !result.loaded.newickStartsWithParen) {
    failures.push('loaded inference did not return a Newick tree')
  }
  if (!Number.isFinite(result.loaded.logLikelihood)) failures.push('loaded inference log-likelihood is not finite')
  if (result.started.newickLength <= 0) failures.push('inference with a starting tree did not return a Newick tree')
  if (result.oneShot.newickLength <= 0) failures.push('one-shot inference did not return a Newick tree')
  if (!result.disposedError.includes('disposed')) failures.push('disposed alignment did not throw')

  console.log(JSON.stringify(result, null, 2))
  if (failures.length) {
    console.error(`SMOKE_FAILED: ${failures.join('; ')}`)
    console.error(browserMessages.join('\n'))
    process.exitCode = 1
  } else {
    console.log('SMOKE_OK')
  }
} finally {
  await browser.close()
  server.close()
}
