#!/usr/bin/env node
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) continue
    args[key.slice(2)] = argv[index + 1]
    index += 1
  }
  return args
}

function parseBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function findPort(host, startPort) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const server = net.createServer()
      server.once('error', () => tryPort(port + 1))
      server.once('listening', () => {
        server.close(() => resolve(port))
      })
      server.listen(port, host)
    }
    tryPort(startPort)
  })
}

function waitForServer(url, timeoutMs) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url)
        if (response.ok) {
          resolve()
          return
        }
      } catch {
        // keep polling
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }
      setTimeout(poll, 250)
    }
    void poll()
  })
}

function readTracingStream(client, stream) {
  return new Promise((resolve, reject) => {
    let trace = ''
    const readChunk = async () => {
      try {
        const response = await client.send('IO.read', { handle: stream })
        trace += response.data ?? ''
        if (response.eof) {
          await client.send('IO.close', { handle: stream })
          resolve(trace)
          return
        }
        void readChunk()
      } catch (error) {
        reject(error)
      }
    }
    void readChunk()
  })
}

async function stopTracing(client) {
  const complete = new Promise((resolve) => {
    client.once('Tracing.tracingComplete', (event) => resolve(event.stream))
  })
  await client.send('Tracing.end')
  const stream = await complete
  return readTracingStream(client, stream)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataset = path.resolve(args.dataset)
  const output = path.resolve(args.output)
  const traceOutput = path.resolve(args.trace ?? output.replace(/\.[^.]+$/, '.trace.json'))
  const logOutput = path.resolve(args.log ?? output.replace(/\.[^.]+$/, '.log'))
  const host = args.host ?? '127.0.0.1'
  const port = await findPort(host, Number(args['start-port'] ?? 5173))
  const timeoutMs = Number(args['server-timeout-seconds'] ?? 120) * 1000
  const logs = []

  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.mkdirSync(path.dirname(traceOutput), { recursive: true })
  fs.mkdirSync(path.dirname(logOutput), { recursive: true })

  const server = spawn(
    'npm',
    ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const log = (line) => {
    logs.push(line)
    console.log(line)
  }

  const captureServer = (stream, prefix) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) log(`${prefix}\t${line}`)
    })
  }
  captureServer(server.stdout, 'SERVER_STDOUT')
  captureServer(server.stderr, 'SERVER_STDERR')

  let browser
  let tracingStarted = false
  try {
    await waitForServer(`http://${host}:${port}`, timeoutMs)
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-precise-memory-info'],
    })
    const page = await browser.newPage({ acceptDownloads: true })
    const client = await page.context().newCDPSession(page)

    page.on('console', (message) => log(`BROWSER_CONSOLE\t${message.text()}`))
    page.on('pageerror', (error) => log(`BROWSER_PAGE_ERROR\t${error.message}`))

    await page.goto(`http://${host}:${port}`, { waitUntil: 'networkidle' })
    await page.locator('input[type=file]').first().setInputFiles(dataset)
    await page.getByRole('button', { name: 'Run' }).waitFor({ state: 'visible', timeout: timeoutMs })

    const branchSupport = parseBool(args['branch-support'] ?? 'true')
    const branchSupportMethod = branchSupport ? (args['branch-support-method'] ?? 'sprta') : 'none'
    const branchSupportReplicates = Number(args.replicates ?? 1000)
    const filterDivergentSamples = parseBool(args['filter-divergent-samples'] ?? 'false')
    const maxDivergencePercent = Number(args['max-divergence-percent'] ?? 6.7)
    const needsAdvancedOptions =
      args.threads !== undefined ||
      branchSupportMethod !== 'sprta' ||
      (branchSupportMethod === 'sh-alrt' && branchSupportReplicates !== 1000) ||
      filterDivergentSamples ||
      maxDivergencePercent !== 6.7

    if (needsAdvancedOptions) {
      await page.locator('details.advanced-options summary').click()

      if (args.threads !== undefined) {
        await page.locator('label.thread-option input[type=range]').fill(String(args.threads))
      }

      const branchSupportCheckbox = page.locator('.branch-support-option > input[type=checkbox]').first()
      if (branchSupportMethod !== 'none') {
        await branchSupportCheckbox.check()
        await page.locator(`input[type=radio][name=branch-support-method][value="${branchSupportMethod}"]`).check()
        if (branchSupportMethod === 'sh-alrt') {
          await page.locator('input[aria-label="SH-aLRT replicates"]').fill(String(branchSupportReplicates))
        }
      } else {
        await branchSupportCheckbox.uncheck()
      }

      const filterCheckbox = page.locator('.divergence-option input[type=checkbox]').first()
      if (filterDivergentSamples) {
        await filterCheckbox.check()
        await page.locator('.divergence-option input[type=range]').fill(String(maxDivergencePercent))
      } else {
        await filterCheckbox.uncheck()
      }
    }

    await client.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      categories: [
        'devtools.timeline',
        'v8',
        'disabled-by-default-v8.cpu_profiler',
        'disabled-by-default-v8.cpu_profiler.hires',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.stack',
      ].join(','),
    })
    tracingStarted = true

    const startedAt = Date.now()
    await page.getByRole('button', { name: 'Run' }).click()
    await page.locator('.tree-reset-button').waitFor({ state: 'visible', timeout: 24 * 60 * 60 * 1000 })
    const elapsedSeconds = (Date.now() - startedAt) / 1000

    const trace = await stopTracing(client)
    tracingStarted = false
    fs.writeFileSync(traceOutput, trace)

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download tree|Downloaded tree/ }).click()
    const download = await downloadPromise
    await download.saveAs(output)

    log(`PROFILE_RESULT\t${JSON.stringify({
      dataset,
      output,
      trace: traceOutput,
      elapsedSeconds,
      downloadedSuggestedFilename: download.suggestedFilename(),
    })}`)
  } finally {
    if (browser) await browser.close()
    if (tracingStarted) {
      log('PROFILE_WARNING\tTracing was still active at shutdown.')
    }
    fs.writeFileSync(logOutput, `${logs.join('\n')}\n`, 'utf8')
    server.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(`PROFILE_ERROR\t${error.stack || error.message}`)
  process.exit(1)
})
