import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
  serviceWorkers: 'block',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.45' },
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
  await page.getByRole('heading', { level: 1 }).waitFor()
  await page.evaluate(() => document.fonts.ready)
}
const inFirstScreen = async (locator, label) => {
  const box = await locator.boundingBox()
  assert.ok(box && box.y >= 0 && box.y + box.height <= 844, `${label} must be in the first screen`)
}

try {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    for (const path of ['/', '/tournaments', '/tournaments/2026-nlc']) {
      await visit(path)
      const action =
        path === '/tournaments'
          ? page.getByRole('searchbox', { name: '搜索赛事', exact: true })
          : page.getByRole('link', { name: '组队报名', exact: true }).first()
      await inFirstScreen(action, `${width}px ${path} primary action`)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({
        path: `${output}/frontend-${path.replaceAll('/', '-') || 'home'}-${width}.png`,
      })
    }
    await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }))
    const nav = await page.getByRole('navigation', { name: '赛事导航' }).boundingBox()
    assert.ok(
      nav && nav.y >= 68 && nav.y <= 120,
      `${width}px tournament navigation must stay below the site header`,
    )
  }

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of [
    '/about',
    '/archive',
    '/games',
    '/games/cs2',
    '/news',
    '/news/season-update',
    '/search',
    '/guestbook',
    '/login',
    '/register',
    '/recover',
    '/tournaments/2026-nlc/schedule',
    '/tournaments/2026-nlc/teams',
    '/tournaments/2026-nlc/teams/FLC',
    '/tournaments/2026-nlc/matches/1',
    '/tournaments/2026-nlc/bracket',
    '/tournaments/2026-nlc/results',
    '/tournaments/2026-nlc/rules',
    '/tournaments/2026-nlc/register',
  ]) {
    await visit(path)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${path} must fit mobile`,
    )
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    assert.deepEqual(
      violations.map(v => ({
        id: v.id,
        targets: v.nodes.map(n => n.target),
        detail: v.nodes.map(n => n.failureSummary),
      })),
      [],
      path,
    )
    await page.screenshot({
      path: `${output}/frontend${path.replaceAll('/', '-')}-390.png`,
      fullPage: true,
    })
  }
  const moreTools = page.getByText('更多赛事工具', { exact: true })
  await moreTools.click()
  await page.getByRole('button', { name: '分享赛事', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await moreTools.click()
  await page.getByRole('link', { name: '登录后报名', exact: true }).click()
  await page.getByRole('link', { name: '还没有账号？创建账号 →' }).click()
  await page.waitForURL(url => url.pathname === '/register')
  assert.equal(new URL(page.url()).searchParams.get('tournamentSlug'), '2026-nlc')
  assert.equal(
    await page.locator('form').getAttribute('action'),
    '/api/auth/register?tournamentSlug=2026-nlc',
  )
  await page.getByRole('link', { name: '已有账号？直接登录 →' }).click()
  await page.waitForURL(url => url.pathname === '/login')
  assert.equal(new URL(page.url()).searchParams.get('redirectKey'), 'registration')
  assert.equal(new URL(page.url()).searchParams.get('tournamentSlug'), '2026-nlc')
  const password = page.getByLabel('密码', { exact: true })
  await password.fill('Visible-password-check')
  await page.getByRole('button', { name: '显示密码', exact: true }).click()
  assert.equal(await password.getAttribute('type'), 'text')
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click()
  assert.equal(await password.getAttribute('type'), 'password')
  await page.getByRole('link', { name: '忘记密码？使用恢复码' }).click()
  await page.waitForURL(url => url.pathname === '/recover')
  assert.equal(new URL(page.url()).searchParams.get('tournamentSlug'), '2026-nlc')

  await visit('/register?tournamentSlug=2026-nlc')
  await page.getByLabel('用户名', { exact: true }).fill('frontend-check')
  await page.getByLabel('显示名称', { exact: true }).fill('交互校验')
  await page.locator('[name="password"]').fill('Unmatched-password-1')
  await page.locator('[name="passwordConfirmation"]').fill('Unmatched-password-2')
  let submitted = false
  page.on('request', request => {
    if (request.method() === 'POST') submitted = true
  })
  await page.getByRole('button', { name: '创建账号', exact: true }).click()
  await page.getByRole('alert').getByText('两次输入的密码不一致。').waitFor()
  assert.equal(submitted, false, 'Mismatched confirmation must not submit')
  assert.equal(
    await page.locator('[name="passwordConfirmation"]').evaluate(e => e === document.activeElement),
    true,
  )

  await visit('/about')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base })
  const copy = page.locator('#join').getByRole('button', { name: '复制群号', exact: true })
  await copy.click()
  await page.locator('#join').getByRole('status').getByText('已复制', { exact: true }).waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.ok(copied.length > 0)
  assert.ok((await page.locator('#join').innerText()).includes(copied))
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error('Clipboard unavailable in test')
    }
  })
  await copy.click()
  const manual = page.getByRole('textbox', { name: '复制群号：手动复制', exact: true })
  assert.equal(await manual.inputValue(), copied)
  await manual.focus()
  assert.equal(await manual.evaluate(e => e.selectionEnd - e.selectionStart), copied.length)

  const native = await browser.newContext({
    extraHTTPHeaders: { 'x-real-ip': '198.51.100.46' },
  })
  const nativeGuard = await installLoopbackRequestGuard(native)
  try {
    const formPage = await native.newPage()
    await formPage.goto(`${base}/register?tournamentSlug=2026-nlc`)
    await formPage.getByLabel('用户名', { exact: true }).fill('invalid username')
    await formPage.getByLabel('显示名称', { exact: true }).fill('原生表单校验')
    await formPage.locator('[name="password"]').fill('Native-form-check-42')
    await formPage.locator('[name="passwordConfirmation"]').fill('Native-form-check-42')
    await formPage.locator('form').evaluate(form => form.submit())
    await formPage.waitForURL(url => url.pathname === '/register' && url.searchParams.has('error'))
    assert.equal(new URL(formPage.url()).searchParams.get('tournamentSlug'), '2026-nlc')
    await formPage.locator('#signup-error[role="alert"]').waitFor()
    nativeGuard.assertSafe()
  } finally {
    await native.close()
  }
  assert.deepEqual(errors, [])
  const noScript = await browser.newContext({ javaScriptEnabled: false })
  const noScriptGuard = await installLoopbackRequestGuard(noScript)
  try {
    const noticePage = await noScript.newPage()
    await noticePage.goto(`${base}/register`)
    await noticePage.getByRole('region', { name: '页面加载提示' }).waitFor()
    noScriptGuard.assertSafe()
  } finally {
    await noScript.close()
  }
  guard.assertSafe()
  console.log(
    'PASS  responsive entry points, sticky navigation, 19 mobile pages, signup continuation, password controls, copy fallback, and native form recovery',
  )
} finally {
  await browser.close()
}
