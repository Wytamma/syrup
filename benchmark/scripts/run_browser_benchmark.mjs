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

function parseBenchLine(line) {
  const match = line.match(/\[CMAPLE bench\]\s+(.*)$/)
  if (!match) return null
  const fields = {}
  for (const token of match[1].split(/\s+/)) {
    const [key, ...rest] = token.split('=')
    if (!key || !rest.length) continue
    fields[key] = rest.join('=').replace(/^"|"$/g, '')
  }
  return fields
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const dataset = path.resolve(args.dataset)
  const output = path.resolve(args.output)
  const host = args.host ?? '127.0.0.1'
  const port = await findPort(host, Number(args['start-port'] ?? 5173))
  const timeoutMs = Number(args['server-timeout-seconds'] ?? 120) * 1000
  const logs = []
  const bench = []

  fs.mkdirSync(path.dirname(output), { recursive: true })

  const server = spawn(
    'npm',
    ['run', 'preview', '--', '--host', host, '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const captureServer = (stream, prefix) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const formatted = `${prefix}\t${line}`
        logs.push(formatted)
        console.log(formatted)
      }
    })
  }
  captureServer(server.stdout, 'SERVER_STDOUT')
  captureServer(server.stderr, 'SERVER_STDERR')

  let browser
  try {
    await waitForServer(`http://${host}:${port}`, timeoutMs)
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ acceptDownloads: true })

    page.on('console', (message) => {
      const text = message.text()
      logs.push(`BROWSER_CONSOLE\t${text}`)
      console.log(`BROWSER_CONSOLE\t${text}`)
      const parsed = parseBenchLine(text)
      if (parsed) bench.push(parsed)
    })

    page.on('pageerror', (error) => {
      console.log(`BROWSER_PAGE_ERROR\t${error.message}`)
    })

    await page.goto(`http://${host}:${port}`, { waitUntil: 'networkidle' })
    await page.locator('input[type=file]').first().setInputFiles(dataset)
    await page.getByRole('button', { name: 'Run' }).waitFor({ state: 'visible', timeout: timeoutMs })

    if (Number(args.threads ?? 4) !== 4) {
      await page.locator('label.thread-option input[type=range]').fill(String(args.threads))
    }

    const branchSupport = parseBool(args['branch-support'])
    const branchSupportMethod = branchSupport ? (args['branch-support-method'] ?? 'sprta') : 'none'
    const branchSupportReplicates = Number(args.replicates ?? 1000)
    const filterDivergentSamples = parseBool(args['filter-divergent-samples'])
    const maxDivergencePercent = Number(args['max-divergence-percent'] ?? 6.7)
    const needsAdvancedOptions =
      branchSupportMethod !== 'sprta' ||
      (branchSupportMethod === 'sh-alrt' && branchSupportReplicates !== 1000) ||
      filterDivergentSamples ||
      maxDivergencePercent !== 6.7

    if (needsAdvancedOptions) {
      await page.locator('details.advanced-options summary').click()

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

    await page.getByRole('button', { name: 'Run' }).click()
    await page.locator('.tree-reset-button').waitFor({ state: 'visible', timeout: 24 * 60 * 60 * 1000 })

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download tree|Downloaded tree/ }).click()
    const download = await downloadPromise
    await download.saveAs(output)

    const result = {
      dataset,
      output,
      port,
      bench,
      downloadedSuggestedFilename: download.suggestedFilename(),
    }
    console.log(`BENCHMARK_RESULT\t${JSON.stringify(result)}`)
  } finally {
    if (browser) await browser.close()
    server.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(`BENCHMARK_ERROR\t${error.stack || error.message}`)
  process.exit(1)
})
