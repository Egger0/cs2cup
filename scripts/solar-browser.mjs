import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const mac = process.platform === 'darwin'
const browser = await chromium.launch({
  ...(mac ? { channel: 'chromium' } : {}),
  args: [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-unsafe-webgpu',
    ...(mac ? ['--use-angle=metal'] : []),
  ],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  serviceWorkers: 'block',
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const base = resolveE2EBaseUrl()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const ready = () => page.locator('[data-solar-ready="true"]').waitFor({ timeout: 30000 })
const frames = () => page.locator('[data-render-count]').getAttribute('data-render-count')
const checkFallback = async target => {
  await target.locator('[data-solar-fallback="true"]').waitFor({ timeout: 30000 })
  await target.locator('[data-solar-key="club"]').press('Enter')
  await target.getByRole('complementary', { name: '星体详情' }).waitFor()
  assert.equal(await target.locator('[data-solar-panel] a[href="/about#join"]').count(), 4)
}

async function exerciseSolar() {
  await page.waitForTimeout(3000)
  const { data: pixels } = await sharp(await page.locator('[data-solar-canvas]').screenshot())
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  assert.ok(
    pixels.filter(value => value > 60).length / pixels.length > 0.01,
    'The solar canvas renders visible bodies',
  )
  await page.getByRole('button', { name: '动态效果', exact: true }).click()
  await page.waitForTimeout(100)
  const paused = await frames()
  await page.waitForTimeout(350)
  assert.equal(await frames(), paused, 'Motion control stops rendering')
  const keys = await page
    .locator('[data-solar-key]:not([data-satellite="true"])')
    .evaluateAll(nodes => nodes.map(node => node.dataset.solarKey))
  assert.ok(keys.length > 1)
  for (const key of keys) {
    const button = page.locator(`[data-solar-key="${key}"]`)
    await button.focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-solar-panel]').waitFor()
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice(1)), key)
    if (key !== 'club') {
      for (const level of ['轨道', '近地', '地表']) {
        const zoom = page.getByRole('button', { name: level, exact: true })
        await zoom.press('Enter')
        assert.equal(await zoom.getAttribute('aria-pressed'), 'true')
      }
    }
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('[data-solar-panel]').count(), 0)
    assert.equal(await button.evaluate(node => node === document.activeElement), true)
  }
  for (const key of await page
    .locator('[data-satellite="true"]')
    .evaluateAll(nodes => nodes.map(node => node.dataset.solarKey))) {
    const button = page.locator(`[data-solar-key="${key}"]`)
    await button.focus()
    await page.keyboard.press('Enter')
    await page.locator('[data-solar-panel]').waitFor()
    assert.equal(await page.locator('[data-solar-panel] a').count(), 4)
    await page.keyboard.press('Escape')
  }
  await page.locator(`[data-solar-key="${keys[1]}"]`).press('Enter')
  const touch = await context.newCDPSession(page)
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  const box = await page.locator('[data-solar-canvas]').boundingBox()
  const centerX = box.x + box.width * 0.4
  const centerY = box.y + box.height * 0.5
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: centerX - 25, y: centerY },
      { x: centerX + 25, y: centerY },
    ],
  })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: centerX - 90, y: centerY },
      { x: centerX + 90, y: centerY },
    ],
  })
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert.equal(
    await page.locator('[data-solar-panel]').count(),
    1,
    'Pinch keeps the focused planet',
  )
  assert.equal(
    await page.getByRole('button', { name: '轨道', exact: true }).getAttribute('aria-pressed'),
    'false',
    'Pinch changes depth',
  )
  await touch.detach()
  await page.goto(`${base}/#${keys[1]}`)
  await ready()
  assert.equal(await page.locator('[data-solar-focus]').getAttribute('data-solar-focus'), keys[1])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(150)
  const reduced = await frames()
  await page.waitForTimeout(350)
  assert.equal(await frames(), reduced, 'Reduced motion stops rendering')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.keyboard.press('Escape')
  const motion = page.getByRole('button', { name: '动态效果', exact: true })
  if ((await motion.getAttribute('aria-pressed')) === 'false') await motion.click()
  await page.waitForFunction(() => document.documentElement.dataset.homeEffects === 'active')
  const rate = async () => {
    await page.waitForTimeout(3500)
    const start = Number(await frames())
    await page.waitForTimeout(800)
    return Number(await frames()) - start
  }
  const near = await rate()
  await page.locator('footer').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.documentElement.dataset.solarChapter === 'far')
  const far = await rate()
  assert.ok(far < near * 0.6, `The far chapter throttles rendering (${far} vs ${near} frames)`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base)
  await ready()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: 'output/playwright/solar-mobile.png' })
}

await page.goto(base)
await page
  .locator('[data-solar-ready="true"], [data-solar-fallback="true"]')
  .first()
  .waitFor({ timeout: 30000 })
const hardware = (await page.locator('[data-solar-fallback="true"]').count()) === 0
if (hardware) await exerciseSolar()
else await checkFallback(page)
const fallback = await context.newPage()
await fallback.addInitScript(() => {
  Object.defineProperty(navigator, 'gpu', { value: undefined })
  const original = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
    if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null
    return original.call(this, kind, ...args)
  }
})
await fallback.goto(base)
await checkFallback(fallback)
assert.deepEqual(errors, [])
guard.assertSafe()
await browser.close()
console.log(
  hardware
    ? 'Solar system: keyboard, depth, satellites, deep links, motion, far-chapter throttling, mobile and fallback passed'
    : 'Solar system: fallback passed; this browser has no hardware acceleration, so the 3D path was not exercised',
)
