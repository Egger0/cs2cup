import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import { assertNoHorizontalOverflow } from './ui-regression-assertions.mjs'

const base = resolveE2EBaseUrl()
const browser = await chromium.launch()
const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await mkdir('output/playwright', { recursive: true })

async function visit(path) {
  const response = await page.goto(base + path)
  assert.ok(response?.ok(), path)
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}

async function contentEdges() {
  return page.locator('[data-layout-container], main .wrap').evaluateAll(elements =>
    elements
      .filter(
        element =>
          element.getBoundingClientRect().width > 0 && !element.parentElement?.closest('.wrap'),
      )
      .map(element => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          label: element.className,
          left: box.left + parseFloat(style.paddingLeft),
          right: box.right - parseFloat(style.paddingRight),
        }
      }),
  )
}

try {
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/tournaments', '/tournaments/2026-nlc', '/news', '/about']) {
      await visit(path)
      const edges = await contentEdges()
      assert.ok(edges.length >= 2, 'The page must expose shared layout containers')
      for (const edge of edges) {
        assert.ok(
          Math.abs(edge.left - edges[0].left) <= 1,
          `${width}px ${path}: ${edge.label} left edge drifts`,
        )
        assert.ok(
          Math.abs(edge.right - edges[0].right) <= 1,
          `${width}px ${path}: ${edge.label} right edge drifts`,
        )
      }
      await assertNoHorizontalOverflow(page, `${width}px ${path}`)
      if (path === '/' && [390, 1440, 1920].includes(width)) {
        await page.screenshot({ path: `output/playwright/arena-home-${width}.png` })
        await page.screenshot({
          path: `output/playwright/arena-home-full-${width}.png`,
          fullPage: true,
        })
      }
    }
    for (const path of ['/login', '/register', '/recover']) {
      await visit(path)
      await assertNoHorizontalOverflow(page, `${width}px ${path}`)
      const form = page.locator('form').first()
      const inputs = form.locator('input:not([type="hidden"])')
      const boxes = await inputs.evaluateAll(elements =>
        elements.map(element => element.getBoundingClientRect().toJSON()),
      )
      for (const box of boxes) assert.equal(box.height, 52, 'Auth inputs use one control height')
      if (path === '/register' && width > 1100) {
        assert.ok(Math.abs(boxes[0].y - boxes[1].y) <= 1, 'Name inputs share the same baseline')
        assert.ok(
          Math.abs(boxes[0].width - boxes[1].width) <= 1,
          'Name inputs share the same width',
        )
        assert.equal(boxes[2].y >= boxes[0].bottom, true)
      }
      const formBox = await form.boundingBox()
      const submitBox = await form.locator('button[type="submit"]').boundingBox()
      assert.ok(Math.abs(formBox.x - submitBox.x) <= 1, 'Submit aligns with the form')
      assert.ok(Math.abs(formBox.width - submitBox.width) <= 1, 'Submit fills the form column')
      if ([390, 1440].includes(width)) {
        await page.screenshot({
          path: `output/playwright/grid${path.replaceAll('/', '-')}-${width}.png`,
          fullPage: true,
        })
      }
    }
  }
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log(
    'PASS  shared page edges at six widths, aligned auth fields, stable control dimensions',
  )
} finally {
  await browser.close()
}
