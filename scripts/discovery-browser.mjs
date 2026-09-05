import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import sharp from 'sharp'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const output = 'output/playwright'
await mkdir(output, { recursive: true })
const visit = async path => {
  const response = await page.goto(`${base}${path}`)
  assert.ok(response?.ok(), `${path} must load`)
}
const checkA11y = async selector => {
  const scan = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  const { violations } = await (selector ? scan.include(selector) : scan).analyze()
  assert.deepEqual(
    violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })),
    [],
  )
}

try {
  await visit('/tournaments')
  const search = page.getByRole('searchbox', { name: '搜索赛事', exact: true })
  await search.fill('没有这场赛事')
  await page.getByRole('heading', { name: '暂时没有找到这场比赛。' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('q'), '没有这场赛事')
  await page.getByRole('button', { name: '查看全部赛事', exact: true }).click()
  await search.fill('ＮＬＣ 2026')
  await page.waitForFunction(
    () =>
      new URL(location.href).searchParams.get('q') === 'ＮＬＣ 2026' &&
      document.querySelectorAll('#all-tournaments article').length === 1,
  )
  assert.equal(await page.locator('#all-tournaments article').count(), 1)
  await page.reload()
  assert.equal(await search.inputValue(), 'ＮＬＣ 2026')
  await search.fill('')
  const follow = page.getByRole('button', { name: '关注 2026 NLC 校园杯', exact: true })
  await follow.click()
  await page.getByRole('button', { name: '取消关注 2026 NLC 校园杯', exact: true }).waitFor()
  await page.getByRole('button', { name: '我的关注 1' }).click()
  await page.reload()
  assert.equal(
    await page.getByRole('button', { name: '我的关注 1' }).getAttribute('aria-pressed'),
    'true',
  )
  assert.equal(await page.locator('#all-tournaments article').count(), 1)
  await page.getByRole('button', { name: '取消关注 2026 NLC 校园杯', exact: true }).click()
  await page.getByRole('heading', { name: '这里，留给你关心的比赛。' }).waitFor()
  await page.getByRole('button', { name: '查看全部赛事', exact: true }).click()
  await checkA11y()

  await visit('/tournaments/2026-nlc')
  const trigger = page.getByRole('button', { name: '分享赛事', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('link', { name: '保存分享卡' }).waitFor({ timeout: 15000 })
  assert.equal(
    new URL(await dialog.getByRole('textbox', { name: '官网直达链接' }).inputValue()).pathname,
    '/tournaments/2026-nlc',
  )
  await checkA11y('dialog')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('link', { name: '保存分享卡' }).click()
  const download = await downloadPromise
  await download.saveAs(`${output}/tournament-share-card.png`)
  const poster = await sharp(await readFile(`${output}/tournament-share-card.png`)).metadata()
  assert.equal(poster.width, 720)
  assert.equal(poster.height, 900)
  await page.screenshot({ path: `${output}/share-verified.png` })
  await page.keyboard.press('Escape')
  assert.equal(await dialog.count(), 0)
  assert.ok(await trigger.evaluate(element => element === document.activeElement))

  await visit('/tournaments/2026-nlc/teams')
  const teamSearch = page.getByRole('searchbox', { name: '搜索战队或队员' })
  await teamSearch.fill('Aster')
  await page.getByRole('heading', { name: 'Mirage', exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('heading', { name: 'Falcons', exact: true }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: 'Mirage', exact: true }).count(), 0)
  await teamSearch.fill('no-such-player')
  await page.getByRole('button', { name: '查看全部战队' }).click()
  assert.equal(await teamSearch.inputValue(), '')
  await checkA11y()

  for (const path of [
    '/tournaments/2026-nlc/teams/FLC',
    '/tournaments/2026-nlc/matches/1',
    '/news/season-update',
  ]) {
    await visit(path)
    assert.equal(
      new URL(await page.locator('link[rel="canonical"]').getAttribute('href')).pathname,
      path,
    )
    assert.ok(await page.locator('meta[property="og:image"]').count())
  }
  await visit('/')
  const identity = JSON.parse(
    await page.locator('script[type="application/ld+json"]').textContent(),
  )
  assert.equal(identity['@graph'][1].name, '宁理电竞社')
  const manifestLink = await page.locator('link[rel="manifest"]').getAttribute('href')
  assert.ok(manifestLink)
  const manifestResponse = await context.request.get(new URL(manifestLink, base).href)
  const manifest = await manifestResponse.json()
  assert.equal(manifest.short_name, '宁理电竞社')
  for (const icon of manifest.icons) {
    const response = await context.request.get(new URL(icon.src, base).href)
    assert.ok(response.ok())
    const metadata = await sharp(await response.body()).metadata()
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes)
  }

  for (const width of [375, 768]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [name, path] of [
      ['home', '/'],
      ['tournaments', '/tournaments'],
      ['tournament', '/tournaments/2026-nlc'],
    ]) {
      await visit(path)
      await page.getByRole('button', { name: '保存与分享官网' }).waitFor()
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
      assert.equal(overflows, false, `${path} must fit ${width}px`)
      await checkA11y()
      await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true })
    }
  }
  await page.getByRole('button', { name: '分享赛事', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name: '保存分享卡' }).waitFor()
  await checkA11y('dialog')
  await page.keyboard.press('Escape')
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log(
    'Discovery, persisted follows, share cards, focus return, team search, metadata, app icons, and mobile accessibility passed',
  )
} finally {
  await browser.close()
}
