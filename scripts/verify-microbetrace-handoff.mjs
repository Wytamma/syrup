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
  await library.evaluate(() => {
    const originalOpen = window.open.bind(window)
    window.__microbeTraceOpenCalls = []
    window.open = (url, target, features) => {
      window.__microbeTraceOpenCalls.push({ target, features: features ?? null })
      return features === undefined
        ? originalOpen(url, target)
        : originalOpen(url, target, features)
    }
  })

  const microbeTracePagePromise = context.waitForEvent('page')
  await library.getByRole('button', { name: 'Open in MicrobeTrace' }).click()
  const microbeTracePage = await microbeTracePagePromise
  const [openCall] = await library.evaluate(() => window.__microbeTraceOpenCalls)
  assert.deepEqual(openCall, { target: '_blank', features: null })
  await microbeTracePage.waitForURL(
    (url) => url.href.startsWith(microbeTraceUrl) && url.hash.startsWith('#handoff='),
    { timeout: 30_000 },
  )
  await microbeTracePage.locator('[data-testid="partner-dataset-name"]').waitFor({ timeout: 120_000 })
  assert.match(
    (await microbeTracePage.locator('[data-testid="partner-dataset-name"]').textContent()) || '',
    /B\.1\.429 — Syrup analysis/,
  )
  await microbeTracePage
    .locator('.lm_tab.lm_active')
    .filter({ hasText: '2D Network' })
    .waitFor({ timeout: 120_000 })
  await microbeTracePage.waitForFunction(
    () => window.commonService?.session?.network?.isFullyLoaded === true,
    undefined,
    { timeout: 120_000 },
  )
  const network = await microbeTracePage.evaluate(() => ({
    distanceSource: window.commonService.session.meta.partnerEmbed?.networkDistanceSource,
    links: window.commonService.session.data.links.map((link) => ({
      origin: link.origin,
      distanceOrigin: link.distanceOrigin,
    })),
  }))
  assert.equal(network.distanceSource, 'sequences')
  assert.ok(network.links.length > 0, 'The MAPLE alignment should produce network links.')
  assert.ok(
    network.links.every((link) => (
      link.distanceOrigin === 'Genetic Distance'
      && link.origin?.length === 1
      && link.origin[0] === 'Genetic Distance'
    )),
    'The 2D network must use only MAPLE sequence distances, not Newick patristic distances.',
  )

  console.log('Syrup → MicrobeTrace handoff verified in a new tab with a MAPLE-only 2D network and retained Newick tree.')
} finally {
  await browser.close()
}
