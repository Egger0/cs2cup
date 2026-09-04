import assert from 'node:assert/strict'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { installLoopbackRequestGuard } from './loopback-url.mjs'

const NEW_PASSWORD = 'Marble orchard signal 2026!'

async function passwordLogin(page, base, username, password) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await Promise.all([
    page.waitForURL(url => url.pathname === '/account'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

async function signOut(page) {
  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
    page.getByRole('button', { name: '退出', exact: true }).click(),
  ])
}

export async function verifyRecoveryPasswordCycle({
  browser,
  page,
  base,
  user,
  recoveryCode,
  assertAccessible,
}) {
  const staleContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'x-real-ip': '198.51.100.120' },
  })
  const staleGuard = await installLoopbackRequestGuard(staleContext)
  const stalePage = await staleContext.newPage()
  const staleRuntimeErrors = captureBrowserRuntimeErrors(stalePage)
  try {
    await passwordLogin(stalePage, base, user.username, user.password)

    await page.goto(`${base}/recover`)
    await page.getByLabel('用户名').fill(user.username)
    await page.getByLabel('恢复码', { exact: true }).fill(recoveryCode)
    await page.getByRole('button', { name: '继续重设密码' }).click()
    await page.waitForURL(url => url.pathname === '/account/security')
    await page.getByRole('heading', { name: '最后一步：设置新密码。' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: '设备与会话' }).count(), 0)
    for (const path of ['/account', '/me', '/tournaments/2026-nlc/register']) {
      await page.goto(`${base}${path}`)
      await page.waitForURL(url => url.pathname === '/account/security')
    }
    await stalePage.reload()
    await stalePage.getByRole('heading', { name: user.displayName }).waitFor()

    await page.locator('input[name="password"]').fill(NEW_PASSWORD)
    await page.locator('input[name="passwordConfirmation"]').fill(`Different ${NEW_PASSWORD}`)
    await page.getByRole('button', { name: '完成恢复并登录' }).click()
    await page.getByText('两次输入的新密码不一致。').waitFor()
    await assertAccessible(page, 'restricted recovery')

    await page.locator('input[name="passwordConfirmation"]').fill(NEW_PASSWORD)
    await Promise.all([
      page.waitForURL(url => url.searchParams.get('password') === 'changed'),
      page.getByRole('button', { name: '完成恢复并登录' }).click(),
    ])
    await page.getByRole('heading', { name: '登录方式保持简单，也留有退路。' }).waitFor()
    await page.getByRole('heading', { name: '设备与会话' }).waitFor()

    await stalePage.goto(`${base}/account`)
    await stalePage.waitForURL(url => url.pathname === '/login')

    await signOut(page)
    await page.goto(`${base}/login`)
    await page.getByLabel('用户名').fill(user.username)
    await page.getByLabel('密码').fill(user.password)
    await page.getByRole('button', { name: '使用账号密码登录' }).click()
    await page.getByText('用户名或密码不正确，请重新输入。').waitFor()
    await page.getByLabel('密码').fill(NEW_PASSWORD)
    await Promise.all([
      page.waitForURL(url => url.pathname === '/account'),
      page.getByRole('button', { name: '使用账号密码登录' }).click(),
    ])
    await page.getByRole('heading', { name: user.displayName }).waitFor()
    staleRuntimeErrors.assertClean('stale recovery session')
  } finally {
    staleGuard.assertSafe()
    await staleContext.close()
  }
}
