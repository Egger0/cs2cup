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

async function expectState(state) {
  await page.waitForFunction(
    value =>
      document.querySelector('[data-home-cover]')?.getAttribute('data-motion-state') === value,
    state,
  )
}
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
  const hero = page.locator('[data-home-cover]')
  await expectState('active')
  await page.mouse.move(1200, 260)
  await page.waitForFunction(
    () => !!document.querySelector('[data-home-cover]')?.style.getPropertyValue('--aim-x'),
  )
  assert.equal(await control.getAttribute('aria-pressed'), 'true')
  assert.equal(
    await page.locator('[data-home-orbit]').evaluate(e => getComputedStyle(e).animationPlayState),
    'running',
  )
  await control.focus()
  await page.keyboard.press('Space')
  await expectState('paused')
  assert.equal(await control.getAttribute('aria-pressed'), 'false')
  assert.equal(await hero.evaluate(e => e.style.getPropertyValue('--aim-x')), '')
  assert.equal(
    await page.locator('[data-home-orbit]').evaluate(e => getComputedStyle(e).animationPlayState),
    'paused',
  )
  await accessible()
  await page.keyboard.press('Space')
  await expectState('active')
  await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }))
  await expectState('paused')
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expectState('active')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expectState('paused')
  assert.equal(await control.isDisabled(), true)
  assert.equal(
    await page.locator('[data-home-orbit]').evaluate(e => getComputedStyle(e).animationName),
    'none',
  )
  await accessible()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expectState('active')
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 900],
    [1440, 900],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height })
    await assertNoHorizontalOverflow(page, `Home ${width}×${height}`)
    const action = await hero.getByRole('link', { name: '组队报名', exact: true }).boundingBox()
    assert.ok(action && action.height >= 44)
    if (height >= 568)
      assert.ok(action.y + action.height <= height, 'The primary action remains above the fold')
    const mark = await page.locator('[data-home-club-mark]').boundingBox()
    assert.ok(mark && mark.width > 70, 'The club mark remains recognizable')
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
    await touch.mouse.move(300, 250)
    assert.equal(
      await touch.locator('[data-home-cover]').evaluate(e => e.style.getPropertyValue('--aim-x')),
      '',
    )
    touchGuard.assertSafe()
  } finally {
    await touchContext.close()
  }
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log(
    'PASS  motion toggle, keyboard, reduced motion, off-screen suspension, touch, responsive entry',
  )
} finally {
  await browser.close()
}
