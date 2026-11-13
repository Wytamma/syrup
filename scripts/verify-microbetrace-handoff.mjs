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
  await page.waitForSelector('main.tree-mode', { timeout: 120_000 })

  const library = await context.newPage()
  await library.goto(new URL('trees.html', syrupUrl).toString())
  assert.equal(await library.evaluate(() => crossOriginIsolated), false, 'The tree library must not be cross-origin isolated.')
  await library.waitForSelector('.tree-row', { timeout: 60_000 })

  const microbeTracePagePromise = context.waitForEvent('page')
  await library.getByRole('button', { name: 'Open in MicrobeTrace' }).click()
  const microbeTracePage = await microbeTracePagePromise
  await microbeTracePage.waitForURL(
    (url) => url.href.startsWith(microbeTraceUrl) && url.hash.startsWith('#handoff='),
    { timeout: 30_000 },
  )
  await microbeTracePage.locator('[data-testid="partner-dataset-name"]').waitFor({ timeout: 120_000 })
  assert.match(
    (await microbeTracePage.locator('[data-testid="partner-dataset-name"]').textContent()) || '',
    /B\.1\.429 — Syrup analysis/,
  )

  console.log('Syrup → MicrobeTrace handoff verified from the tree library with the MAPLE alignment and Newick tree.')
} finally {
  await browser.close()
}
