import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const syrupUrl = process.env.SYRUP_URL || 'http://localhost:5173/'
const microbeTraceUrl = process.env.MICROBETRACE_URL || 'http://localhost:4200/'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext()

try {
  const page = await context.newPage()
  await page.goto(new URL('?alignment=/B.1.429.maple', syrupUrl).toString())
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'Syrup must remain cross-origin isolated.')

  await page.getByRole('dialog', { name: 'Alignment ready' }).waitFor()
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  const openButton = page.getByRole('button', { name: 'Open tree and alignment in MicrobeTrace' })
  await openButton.waitFor({ timeout: 120_000 })

  const bridgePromise = context.waitForEvent('page')
  await openButton.click()
  const bridge = await bridgePromise
  await bridge.waitForURL(/\/microbetrace-export\.html#handoff=/)
  await bridge.waitForLoadState('domcontentloaded')
  assert.equal(await bridge.evaluate(() => crossOriginIsolated), false, 'The export bridge must not be cross-origin isolated.')
  await bridge.getByRole('button', { name: 'Open in MicrobeTrace' }).waitFor()
  const summary = await bridge.locator('#summary').textContent()
  assert.match(summary || '', /B\.1\.429\.maple/)
  assert.match(summary || '', /B\.1\.429\.nwk/)

  const microbeTracePagePromise = context.waitForEvent('page')
  await bridge.getByRole('button', { name: 'Open in MicrobeTrace' }).click()
  const microbeTracePage = await microbeTracePagePromise
  await microbeTracePage.waitForURL(
    (url) => url.href.startsWith(microbeTraceUrl) && url.hash.startsWith('#handoff='),
    { timeout: 30_000 },
  )
  await microbeTracePage.locator('[data-testid="partner-dataset-name"]').waitFor({ timeout: 120_000 })
  assert.match(
    await microbeTracePage.locator('[data-testid="partner-dataset-name"]').textContent() || '',
    /B\.1\.429 — Syrup analysis/,
  )

  console.log('Syrup → MicrobeTrace handoff verified with MAPLE and Newick files.')
} finally {
  await browser.close()
}
