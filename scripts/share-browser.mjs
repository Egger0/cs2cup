import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const engine = process.env.SHARE_BROWSER === 'webkit' ? webkit : chromium
const browser = await engine.launch()
const context = await browser.newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' })
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const output = 'output/playwright'
await mkdir(output, { recursive: true })

const cases = [
  { name: 'footer-home', path: '/', trigger: '保存与分享官网', tips: true },
  { name: 'directory', path: '/tournaments', trigger: '分享赛事大厅' },
  { name: 'tournament', path: '/tournaments/2026-nlc', trigger: '分享赛事' },
  {
    name: 'schedule',
    path: '/tournaments/2026-nlc/schedule',
    trigger: '分享赛事',
    disclosure: true,
  },
  { name: 'team', path: '/tournaments/2026-nlc/teams/FLC', trigger: '分享战队' },
  { name: 'match', path: '/tournaments/2026-nlc/matches/1', trigger: '分享这场比赛' },
  { name: 'news', path: '/news/season-update', trigger: '分享这篇动态' },
  { name: 'footer-news', path: '/news/season-update', trigger: '保存与分享官网', tips: true },
]

async function openShare(testCase) {
  const response = await page.goto(`${base}${testCase.path}`)
  assert.ok(response?.ok(), `${testCase.path} must load`)
  if (testCase.disclosure) await page.getByText('更多赛事工具', { exact: true }).click()
  const trigger = page.getByRole('button', { name: testCase.trigger, exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  return { trigger, dialog }
}

async function checkDialog(dialog, label) {
  const intro = dialog.getByText('把链接发进群聊，或保存带二维码的图片。朋友扫码就能来到这里。')
  const type = await intro.evaluate(element => {
    const style = getComputedStyle(element)
    return { size: parseFloat(style.fontSize), color: style.color, weight: style.fontWeight }
  })
  assert.ok(type.size >= 14 && type.size <= 16, `${label}: readable body type, got ${type.size}px`)
  assert.equal(
    type.color,
    'rgb(95, 96, 90)',
    `${label}: text must not inherit a dark section theme`,
  )
  assert.equal(type.weight, '400', `${label}: body copy must not inherit headline weight`)
  assert.ok(await dialog.evaluate(element => element.parentElement === document.body))
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
  const box = await dialog.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, `${label}: horizontal fit`)
  assert.ok(box.y >= 0 && box.y + box.height <= viewport.height + 1, `${label}: vertical fit`)
  const input = dialog.getByRole('textbox', { name: '官网直达链接' })
  assert.ok(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize) >= 16))
  const { violations } = await new AxeBuilder({ page })
    .include('dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })),
    [],
    label,
  )
}

try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    for (const testCase of cases) {
      const label = `${testCase.name} at ${viewport.width}x${viewport.height}`
      const { trigger, dialog } = await openShare(testCase)
      await dialog.getByRole('link', { name: '保存分享卡' }).waitFor({ timeout: 15000 })
      await dialog.getByRole('img').evaluate(element => element.decode())
      await checkDialog(dialog, label)
      if (viewport.width <= 390) {
        for (const control of [
          dialog.getByRole('button', { name: '复制链接', exact: true }),
          dialog.getByRole('link', { name: '保存分享卡' }),
        ]) {
          const box = await control.boundingBox()
          assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `${label}: actions first`)
          assert.ok(box.height >= 44, `${label}: comfortable touch target`)
        }
      }
      await page.screenshot({
        path: `${output}/share-${engine.name()}-${testCase.name}-${viewport.width}.png`,
      })
      if (testCase.tips) {
        await dialog.getByText('把官网放到手机主屏幕', { exact: true }).click()
        await dialog
          .getByText('电脑端可按 Ctrl + D（Mac 为 ⌘ + D）收藏官网。')
          .scrollIntoViewIfNeeded()
        await checkDialog(dialog, `${label}, expanded access tips`)
        const close = await dialog.getByRole('button', { name: '关闭分享' }).boundingBox()
        assert.ok(
          close.y >= 0 && close.y + close.height <= viewport.height,
          `${label}: close stays reachable`,
        )
      }
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.ok(
        await trigger.evaluate(element => element === document.activeElement),
        `${label}: focus return`,
      )
      await page.waitForFunction(() => document.documentElement.style.overflow !== 'hidden')
    }
    console.log(`Share layout and accessibility passed at ${viewport.width}x${viewport.height}`)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('Clipboard unavailable')
        },
      },
    })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new Error('Native sharing unavailable')
      },
    })
  })
  const { dialog } = await openShare(cases[0])
  await dialog.getByRole('link', { name: '保存分享卡' }).waitFor()
  for (let index = 0; index < 9; index += 1) {
    await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab')
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)))
  }
  await dialog.getByRole('button', { name: '复制链接', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: '请复制下方选中的链接。' }).waitFor()
  assert.ok(
    await dialog
      .getByRole('textbox')
      .evaluate(
        element =>
          element === document.activeElement && element.selectionEnd === element.value.length,
      ),
  )
  await checkDialog(dialog, 'clipboard fallback')
  await dialog.getByRole('button', { name: '打开系统分享' }).click()
  await dialog.getByRole('status').filter({ hasText: '暂时无法打开系统分享' }).waitFor()
  await checkDialog(dialog, 'native share fallback')
  await page.mouse.click(2, 2)
  await dialog.waitFor({ state: 'detached' })

  await page.route('**/brand/club-mark.svg', route => route.abort())
  const failed = await openShare(cases[0])
  await failed.dialog.getByText('图片暂时无法生成，仍可分享链接。', { exact: true }).waitFor()
  await checkDialog(failed.dialog, 'poster failure')
  await failed.dialog.getByRole('button', { name: '复制链接', exact: true }).click()
  await failed.dialog.getByRole('status').filter({ hasText: '请复制下方选中的链接。' }).waitFor()
  await failed.dialog.getByRole('button', { name: '关闭分享' }).click()
  await failed.dialog.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log(
    `${engine.name()}: all share entry points, responsive layouts, expanded tips, and failure states passed`,
  )
} finally {
  await browser.close()
}
