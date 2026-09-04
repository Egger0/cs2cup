import assert from 'node:assert/strict'

import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { BROWSER_USERS } from './identity-browser-users.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import {
  assertLightSurface,
  assertMinimumTapHeight,
  assertNoHorizontalOverflow,
  assertStacked,
} from './ui-regression-assertions.mjs'

const BASE = resolveE2EBaseUrl()
const USER = BROWSER_USERS.signup

async function assertAccessible(page, label) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  if (violations.length) {
    const detail = violations.map(item => `${item.id} (${item.nodes.length})`).join(', ')
    throw new Error(`${label} accessibility violations: ${detail}`)
  }
}

async function fillSignup(page) {
  await page.getByLabel('用户名').fill(USER.username)
  await page.getByLabel('显示名称').fill(USER.displayName)
  await page.locator('[name="password"]').fill(USER.password)
  await page.locator('[name="passwordConfirmation"]').fill(USER.password)
}

async function registrationResponse(page) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/auth/register' && response.request().method() === 'POST'
  })
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.44' },
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const runtimeErrors = captureBrowserRuntimeErrors(page, {
  allowedConsoleErrors: [
    /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/,
    /^Failed to load resource: the server responded with a status of 500 \(Internal Server Error\)$/,
  ],
})

try {
  await page.goto(`${BASE}/register`)
  await assertAccessible(page, 'account signup')
  await fillSignup(page)
  const createdResponse = registrationResponse(page)
  await page.getByRole('button', { name: '创建账号' }).click()
  const created = await createdResponse
  assert.equal(created.status(), 200)
  await page.waitForURL(
    url => url.pathname === '/account' && url.searchParams.get('welcome') === '1',
  )
  await page.getByRole('status').getByText('账号已创建').waitFor()
  await page.getByRole('heading', { name: USER.displayName }).waitFor()
  await page.getByText('账号密码', { exact: true }).waitFor()

  const skipLink = page.getByRole('link', { name: '跳到主内容' })
  await skipLink.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.closest('#main') !== null), true)

  const membership = page.getByRole('region', { name: '尚未申请' })
  const security = page.getByRole('region', { name: '账号与安全' })
  await assertLightSurface(security, 'account security card')
  await page.setViewportSize({ width: 781, height: 900 })
  await assertStacked(membership, security, 'account at 781px')
  await page.setViewportSize({ width: 390, height: 844 })
  await assertNoHorizontalOverflow(page, 'mobile account')
  await assertMinimumTapHeight(
    page.getByRole('navigation', { name: '账号导航' }).locator('a, button'),
    'mobile account navigation',
  )
  await page.setViewportSize({ width: 1280, height: 900 })

  const delayedSecurityRoutes = [
    '**/api/auth/passkeys',
    '**/api/account/security/recovery-codes',
    '**/api/account/security/sessions',
  ]
  for (const pattern of delayedSecurityRoutes) {
    await page.route(pattern, async route => {
      if (route.request().method() === 'GET') {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 600))
      }
      await route.continue()
    })
  }
  await page.goto(`${BASE}/account/security`)
  await page.getByText(`@${USER.username}`, { exact: true }).waitFor()
  await page.getByRole('heading', { name: '设备与会话' }).waitFor()
  for (const name of ['你的设备密钥', '账号的离线退路', '设备与会话']) {
    const region = page.getByRole('region', { name })
    assert.equal(await region.getAttribute('aria-busy'), 'true')
    await region.getByText('读取中…', { exact: true }).waitFor()
  }
  await page.waitForFunction(
    () => document.querySelectorAll('section[aria-busy="true"]').length === 0,
  )
  for (const pattern of delayedSecurityRoutes) await page.unroute(pattern)

  const signOutPattern = '**/api/auth/session'
  await page.route(signOutPattern, async route => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      return
    }
    await route.continue()
  })
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.getByRole('alert').getByText('退出暂未完成，请检查网络后重试。').waitFor()
  assert.equal(await page.getByRole('button', { name: '退出', exact: true }).isEnabled(), true)
  await page.unroute(signOutPattern)
  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
    page.getByRole('button', { name: '退出', exact: true }).click(),
  ])

  await page.goto(`${BASE}/register`)
  await fillSignup(page)
  const duplicateResponse = registrationResponse(page)
  await page.getByRole('button', { name: '创建账号' }).click()
  const duplicate = await duplicateResponse
  assert.equal(duplicate.status(), 409)
  await page.getByText('这个用户名不可用，请换一个再试。').waitFor()
  assert.equal(await page.getByLabel('用户名').getAttribute('aria-invalid'), 'true')
  assert.equal(
    await page.getByLabel('用户名').evaluate(element => element === document.activeElement),
    true,
  )
  await assertAccessible(page, 'duplicate signup error')

  await page.goto(`${BASE}/login`)
  await page.getByLabel('用户名').fill(USER.username)
  await page.getByLabel('密码').fill(USER.password)
  await Promise.all([
    page.waitForURL(url => url.pathname === '/account'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
  await page.getByRole('heading', { name: USER.displayName }).waitFor()
  runtimeErrors.assertClean('signup browser')
  console.log('PASS  self-signup, duplicate username validation and password login')
} finally {
  guard.assertSafe()
  await context.close()
  await browser.close()
}
