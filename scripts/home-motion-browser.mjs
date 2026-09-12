import assert from 'node:assert/strict'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import { assertNoHorizontalOverflow } from './ui-regression-assertions.mjs'

const base = resolveE2EBaseUrl()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

const rootData = (name, value) =>
  page.waitForFunction(
    ([key, expected]) => document.documentElement.dataset[key] === expected,
    [name, value],
  )
async function accessible() {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })),
    [],
  )
}

try {
  await page.goto(base)
  await page.evaluate(() => document.fonts.ready)
  const control = page.getByRole('button', { name: '动态效果', exact: true })
  await control.waitFor()
  await rootData('homeEffects', 'active')
  assert.equal(await control.getAttribute('aria-pressed'), 'true')
  await control.focus()
  await page.keyboard.press('Space')
  await rootData('homeEffects', 'paused')
  assert.equal(await control.getAttribute('aria-pressed'), 'false')
  await accessible()
  await page.keyboard.press('Space')
  await rootData('homeEffects', 'active')
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight * 0.72, behavior: 'instant' }),
  )
  await rootData('solarChapter', 'far')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await rootData('solarChapter', 'near')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await rootData('homeEffects', 'paused')
  assert.equal(await control.isDisabled(), true)
  await accessible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await rootData('homeEffects', 'active')
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 900],
    [1440, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height })
    await assertNoHorizontalOverflow(page, `Home ${width}×${height}`)
    const action = await page
      .getByRole('complementary', { name: '当前赛事入口' })
      .getByRole('link')
      .last()
      .boundingBox()
    assert.ok(action && action.height >= 44, 'The current tournament action is touch-sized')
    if (height >= 568)
      assert.ok(action.y + action.height <= height, 'The primary action remains above the fold')
    const title = await page.getByRole('heading', { level: 1 }).boundingBox()
    assert.ok(title && title.y >= 0, 'The club title stays on screen')
  }
  await page.goto(base + '/about')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.homeEffects), undefined)
  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const touchGuard = await installLoopbackRequestGuard(touchContext)
  try {
    const touch = await touchContext.newPage()
    await touch.goto(base)
    await touch.getByRole('button', { name: '动态效果' }).waitFor()
    await assertNoHorizontalOverflow(touch, 'Home touch 390×844')
    touchGuard.assertSafe()
  } finally {
    await touchContext.close()
  }
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log('PASS  motion toggle, keyboard, reduced motion, chapters, touch, responsive entry')
} finally {
  await browser.close()
}
