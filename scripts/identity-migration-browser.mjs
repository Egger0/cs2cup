import assert from 'node:assert/strict'

import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { BROWSER_LEGACY, BROWSER_USERS } from './identity-browser-users.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const BASE = resolveE2EBaseUrl()

async function passwordLogin(page, user, redirectKey = 'account') {
  await page.goto(`${BASE}/login?redirectKey=${redirectKey}`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/login'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

async function grantLegacyCheckIn(page) {
  await passwordLogin(page, BROWSER_USERS.owner, 'workspaces')
  await page.goto(`${BASE}/admin/tournaments/${BROWSER_LEGACY.tournamentId}/staff`)
  await page.getByRole('heading', { name: '签到权限' }).waitFor()
  const candidates = page.getByLabel('选择已绑定报名')
  const option = candidates.locator('option').filter({ hasText: BROWSER_LEGACY.teamName })
  const principalId = await option.getAttribute('value')
  assert.match(principalId ?? '', /^p_[A-Za-z0-9_-]{43}$/)
  await candidates.selectOption(principalId)
  await page.getByRole('button', { name: '开放签到权限' }).click()
  await page.getByText(/签到权限已开放/).waitFor()
  await page.locator('li').filter({ hasText: BROWSER_LEGACY.teamName }).waitFor()
}

async function claimLegacyRegistration(page) {
  return page.evaluate(async legacy => {
    const decode = value => {
      const padded = value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=')
      return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
    }
    const encode = value => {
      const bytes = new Uint8Array(value)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    }
    const optionsResponse = await fetch('/api/participant/passkeys/claim/options', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: '2026-nlc', token: legacy.managementToken }),
    })
    if (!optionsResponse.ok) return { optionsStatus: optionsResponse.status }
    const options = await optionsResponse.json()
    const credential = await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: decode(options.challenge),
        user: { ...options.user, id: decode(options.user.id) },
        excludeCredentials: options.excludeCredentials?.map(item => ({
          ...item,
          id: decode(item.id),
        })),
      },
    })
    if (!(credential instanceof PublicKeyCredential)) throw new Error('Passkey was not created')
    const response = credential.response
    if (!(response instanceof AuthenticatorAttestationResponse)) {
      throw new Error('Unexpected Passkey response')
    }
    const verifyResponse = await fetch('/api/participant/passkeys/claim/verify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: credential.id,
        rawId: encode(credential.rawId),
        response: {
          attestationObject: encode(response.attestationObject),
          clientDataJSON: encode(response.clientDataJSON),
          transports: response.getTransports?.(),
          publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
          publicKey: response.getPublicKey?.() ? encode(response.getPublicKey()) : undefined,
          authenticatorData: response.getAuthenticatorData?.()
            ? encode(response.getAuthenticatorData())
            : undefined,
        },
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        authenticatorAttachment: credential.authenticatorAttachment,
      }),
    })
    return { credentialId: credential.id, optionsStatus: 200, verifyStatus: verifyResponse.status }
  }, BROWSER_LEGACY)
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.42' },
})
const guard = await installLoopbackRequestGuard(context)
await context.credentials.install()
const page = await context.newPage()
const runtimeErrors = captureBrowserRuntimeErrors(page)
const ownerContext = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.43' },
})
const ownerGuard = await installLoopbackRequestGuard(ownerContext)
const ownerPage = await ownerContext.newPage()
const ownerRuntimeErrors = captureBrowserRuntimeErrors(ownerPage)

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const claim = await claimLegacyRegistration(page)
  assert.deepEqual(
    { optionsStatus: claim.optionsStatus, verifyStatus: claim.verifyStatus },
    { optionsStatus: 200, verifyStatus: 204 },
  )
  assert.match(claim.credentialId ?? '', /^[A-Za-z0-9_-]+$/)
  await grantLegacyCheckIn(ownerPage)

  await page.goto(`${BASE}/me`)
  await page.getByRole('heading', { name: '我的赛事' }).waitFor()
  await page.getByText(BROWSER_LEGACY.teamName).waitFor()
  await Promise.all([
    page.waitForURL(
      url => url.pathname === '/login' && url.searchParams.get('reason') === 'signed-out',
    ),
    page.getByRole('button', { name: '退出旧登录方式' }).click(),
  ])

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '使用通行密钥登录' }).click()
  await page.waitForURL(url => url.pathname === '/account')
  await page.getByRole('heading', { name: BROWSER_LEGACY.displayName }).waitFor()
  await page.goto(`${BASE}/account/security`)
  await page.getByRole('heading', { name: '补上用户名与密码' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '修改密码' }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '你的设备密钥' }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '账号的离线退路' }).count(), 0)
  assert.equal(await page.getByRole('heading', { name: '设备与会话' }).count(), 0)

  const recoveryGuard = await context.request.post(`${BASE}/api/account/security/recovery-codes`, {
    headers: { Accept: 'application/json', Origin: BASE },
  })
  const passkeyGuard = await context.request.delete(`${BASE}/api/auth/passkeys`, {
    data: { credentialId: claim.credentialId },
    headers: { Accept: 'application/json', Origin: BASE },
  })
  assert.equal(recoveryGuard.status(), 409)
  assert.match((await recoveryGuard.json()).error, /完成账号设置/)
  assert.equal(passkeyGuard.status(), 409)
  assert.match((await passkeyGuard.json()).error, /完成账号设置|另一个 Passkey/)

  await page.locator('input[name="username"]').fill(BROWSER_LEGACY.username)
  await page.locator('input[name="password"]').fill(BROWSER_LEGACY.password)
  await page
    .locator('input[name="passwordConfirmation"]')
    .fill(`${BROWSER_LEGACY.password} mismatch`)
  await page.getByRole('button', { name: '完成账号设置' }).click()
  await page.getByText('两次输入的密码不一致。').waitFor()
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  assert.deepEqual(
    violations.map(item => item.id),
    [],
  )
  await page.locator('input[name="passwordConfirmation"]').fill(BROWSER_LEGACY.password)
  const setupResponse = page.waitForResponse(
    response =>
      response.url().endsWith('/api/account/security/initial-setup') &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: '完成账号设置' }).click()
  assert.equal((await setupResponse).status(), 200)
  await page.getByRole('heading', { name: '修改密码' }).waitFor()
  const recovery = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '账号的离线退路' }) })
  await recovery.getByRole('button', { name: '生成恢复码' }).click()
  const recoveryCode = (await recovery.locator('ol li').first().textContent())?.trim() ?? ''
  assert.match(recoveryCode, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/)

  await ownerPage.reload()
  assert.equal(
    await ownerPage
      .getByLabel('选择已绑定报名')
      .locator('option')
      .filter({ hasText: BROWSER_LEGACY.teamName })
      .count(),
    0,
  )
  assert.equal(
    await ownerPage.locator('li').filter({ hasText: BROWSER_LEGACY.teamName }).count(),
    0,
  )

  await Promise.all([
    page.waitForURL(url => url.pathname === '/'),
    page.getByRole('button', { name: '退出', exact: true }).click(),
  ])
  await passwordLogin(page, BROWSER_LEGACY, 'workspaces')
  await page.getByRole('heading', { name: '我的工作区' }).waitFor()
  await page.getByRole('heading', { name: BROWSER_LEGACY.tournamentTitle }).waitFor()
  await page.getByRole('link', { name: '打开签到台' }).click()
  await page.getByRole('heading', { name: '现场签到' }).waitFor()
  runtimeErrors.assertClean('legacy migration browser')
  ownerRuntimeErrors.assertClean('legacy migration owner browser')
  console.log('PASS  legacy Passkey setup, password login, recovery and check-in role migration')
} finally {
  guard.assertSafe()
  ownerGuard.assertSafe()
  await ownerContext.close()
  await context.close()
  await browser.close()
}
