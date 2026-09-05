import assert from 'node:assert/strict'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { COMPROMISED_PASSWORD_MESSAGE } from '../lib/identity/registration-feedback.ts'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.61' },
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))

try {
  await page.goto(base + '/register?tournamentSlug=2026-nlc')
  const username = page.getByLabel('用户名', { exact: true })
  const password = page.getByLabel('密码', { exact: true })
  const confirmation = page.locator('[name="passwordConfirmation"]')
  const submit = page.getByRole('button', { name: '创建账号', exact: true })
  const probeName = 'feedback.' + Date.now()
  await username.fill(probeName)
  assert.equal(await page.getByLabel('显示名称', { exact: true }).getAttribute('required'), null)
  // A deliberately compromised fixture value rejects before any account is created.
  await password.fill('password')
  await confirmation.fill('password')
  await page.evaluate(() => document.fonts.ready)
  const before = await submit.boundingBox()
  const responsePromise = page.waitForResponse(
    response =>
      response.url().includes('/api/auth/register') && response.request().method() === 'POST',
  )
  await submit.click()
  const response = await responsePromise
  assert.equal(response.status(), 400)
  const result = await response.json()
  assert.equal(
    result.code,
    'password_compromised',
    'An omitted display name defaults on the server',
  )
  assert.equal(result.field, 'password')
  await page.locator('#signup-error').getByText(COMPROMISED_PASSWORD_MESSAGE).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('name') === 'password')
  assert.equal(await username.inputValue(), probeName, 'Failed signup preserves other inputs')
  const after = await submit.boundingBox()
  assert.ok(Math.abs(before.y - after.y) <= 1, 'An error does not move the submit button')
  assert.match(await password.getAttribute('aria-describedby'), /signup-error/)
  await password.fill('A different local test phrase')
  assert.equal(
    await page.locator('#signup-error').count(),
    0,
    'Editing the affected field removes stale errors',
  )
  assert.equal(await password.getAttribute('aria-invalid'), 'false')
  await confirmation.fill('A different local test phrase')

  await page.route('**/api/auth/register*', route => route.abort('failed'))
  await submit.click()
  await page.getByRole('link', { name: '尝试登录 →' }).waitFor()
  assert.match(await page.locator('#signup-error').innerText(), /没能确认/)
  assert.equal(await username.inputValue(), probeName)
  assert.match(
    await page.getByRole('link', { name: '尝试登录 →' }).getAttribute('href'),
    /tournamentSlug=2026-nlc/,
  )
  assert.ok(Math.abs(before.y - (await submit.boundingBox()).y) <= 1)
  await confirmation.fill('A mismatched local test phrase')
  await submit.click()
  await page.getByRole('alert').getByText('两次输入的密码不一致。').waitFor()
  assert.equal(await page.getByRole('link', { name: '尝试登录 →' }).count(), 0)
  await page.unroute('**/api/auth/register*')
  await page.screenshot({ path: 'output/playwright/auth-network-recovery.png', fullPage: true })

  for (const flow of [
    {
      path: '/login',
      endpoint: '**/api/auth/session',
      field: 'password',
      button: '使用账号密码登录',
      error: '用户名或密码不正确，请重新输入。',
    },
    {
      path: '/recover',
      endpoint: '**/api/auth/recovery-code',
      field: 'code',
      button: '继续重设密码',
      error: '用户名或恢复码不正确，请检查后重试。',
    },
  ]) {
    await page.goto(base + flow.path + '?tournamentSlug=2026-nlc')
    await page.getByLabel('用户名', { exact: true }).fill('feedback.probe')
    await page.locator(`[name="${flow.field}"]`).fill('Local-test-only')
    let release
    const held = new Promise(resolve => {
      release = resolve
    })
    await page.route(flow.endpoint, async route => {
      await held
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: flow.error }),
      })
    })
    const button = page.getByRole('button', { name: flow.button, exact: true })
    const position = await button.boundingBox()
    await button.click()
    assert.equal(await page.locator('form').getAttribute('aria-busy'), 'true')
    assert.equal(await page.locator(`[name="${flow.field}"]`).isDisabled(), true)
    release()
    await page.getByRole('alert').getByText(flow.error).waitFor()
    assert.equal(await page.getByLabel('用户名', { exact: true }).inputValue(), 'feedback.probe')
    assert.ok(Math.abs(position.y - (await button.boundingBox()).y) <= 1)
    await page.locator(`[name="${flow.field}"]`).fill('Edited-test-only')
    assert.equal(await page.locator('form [role="alert"]').count(), 0)
    await page.unroute(flow.endpoint)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    assert.deepEqual(
      violations.map(item => item.id),
      [],
    )
  }
  await page.getByText('没有保存恢复码？', { exact: true }).click()
  await page.getByRole('link', { name: '仍无法登录？联系社团咨询 →' }).waitFor()
  assert.deepEqual(errors, [])
  guard.assertSafe()
  console.log(
    'PASS  optional profile name, understandable errors, unchanged button position, preserved inputs, recovery paths',
  )
} finally {
  await browser.close()
}
