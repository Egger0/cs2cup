import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { blockClientChunkContaining } from './client-chunk-blocker.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const publicHrefs = '/tournaments,/news,/archive,/games,/about,/guestbook,/search,/login,/register'
const browser = await chromium.launch()

try {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 760 },
      serviceWorkers: 'block',
    })
    const guard = await installLoopbackRequestGuard(context)
    const chunks = await blockClientChunkContaining(context, base, 'data-site-header-fallback')
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(base, { waitUntil: 'load' })
      await chunks.waitForBlocked()
      const fallback = page.locator('[data-site-header-fallback]')
      await fallback.waitFor({ state: 'visible' })
      await fallback.locator('summary').press('Enter')
      const links = page.getByRole('navigation', { name: '基础站点目录链接' })
      const hrefs = await links
        .locator('a')
        .evaluateAll(nodes => nodes.map(n => n.getAttribute('href')))
      assert.equal(hrefs.join(','), publicHrefs)
      assert.equal(await fallback.evaluate(element => element.open), true)
      assert.equal(await page.getByRole('button', { name: '打开全站目录' }).count(), 0)
      assert.ok(await page.locator('main').isVisible())
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      )
      await links.getByRole('link', { name: '项目', exact: true }).focus()
      const previous = chunks.count()
      await Promise.all([
        page.waitForURL(/\/games$/, { waitUntil: 'domcontentloaded' }),
        page.keyboard.press('Enter'),
      ])
      await chunks.waitForBlocked(previous)
      await fallback.waitFor({ state: 'visible' })
      await page.waitForLoadState('networkidle')
      assert.equal(await fallback.count(), 1)
      assert.deepEqual(errors, [])
      guard.assertSafe()
      console.log(
        `PASS  Native directory and keyboard navigation survive failed chunks (${attempt + 1}/4)`,
      )
    } finally {
      await context.unrouteAll({ behavior: 'wait' })
      await context.close()
    }
  }
} finally {
  await browser.close()
}
