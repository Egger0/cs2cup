import assert from 'node:assert/strict'

import { chromium } from 'playwright'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { BROWSER_USERS } from './identity-browser-users.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import { assertMinimumTapHeight, assertNoHorizontalOverflow } from './ui-regression-assertions.mjs'

const BASE = resolveE2EBaseUrl()
const PHONE = { width: 390, height: 844 }

async function open(browser, viewport, allowedConsoleErrors = []) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'x-real-ip': '198.51.100.63' },
  })
  const guard = await installLoopbackRequestGuard(context)
  const page = await context.newPage()
  return {
    context,
    guard,
    page,
    runtimeErrors: captureBrowserRuntimeErrors(page, { allowedConsoleErrors }),
  }
}

async function login(page, user) {
  await page.goto(`${BASE}/login?redirectKey=account`)
  await page.getByLabel('用户名').fill(user.username)
  await page.getByLabel('密码', { exact: true }).fill(user.password)
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/login'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

async function approveApplicant(page) {
  await page.goto(`${BASE}/admin/identity`)
  const card = page.locator('article', { hasText: BROWSER_USERS.applicant.displayName }).first()
  if ((await card.count()) === 0) return
  const claim = card.getByRole('button', { name: '领取并开始审核' })
  if (await claim.isVisible().catch(() => false)) await claim.click()
  await card.getByLabel('决定').selectOption({ label: '通过并授予成员资格' })
  await card.getByLabel('给申请者的说明').fill('抽奖闸门：资料齐全，准予通过。')
  await card.getByRole('button', { name: '确认审核决定' }).click()
  await page.getByText('资格有效').first().waitFor()
}

const browser = await chromium.launch()
const sessions = []

try {
  const anonymous = await open(browser, PHONE)
  sessions.push(anonymous)
  await anonymous.page.goto(`${BASE}/lottery`)
  await anonymous.page.getByRole('heading', { name: '登录后参与抽奖' }).waitFor()
  await assertNoHorizontalOverflow(anonymous.page, '/lottery signed out on a phone')
  await anonymous.page.setViewportSize({ width: 1440, height: 900 })
  await anonymous.page.reload()
  await assertNoHorizontalOverflow(anonymous.page, '/lottery signed out on a desktop')

  const toggle = anonymous.page.getByRole('button', { name: '打开全站目录' })
  await toggle.click()
  await anonymous.page.getByRole('button', { name: '关闭全站目录' }).waitFor()
  await anonymous.page
    .getByRole('navigation', { name: '全部页面' })
    .getByRole('link', { name: /招新抽奖/ })
    .waitFor()
  await anonymous.page.keyboard.press('Escape')
  await toggle.waitFor()

  const reviewer = await open(browser, { width: 1280, height: 900 })
  sessions.push(reviewer)
  await login(reviewer.page, BROWSER_USERS.reviewer)
  await approveApplicant(reviewer.page)

  const member = await open(browser, PHONE, ['net::ERR_INTERNET_DISCONNECTED'])
  sessions.push(member)
  await login(member.page, BROWSER_USERS.applicant)
  await member.page.goto(`${BASE}/lottery`)
  const draw = member.page.getByRole('button', { name: '抽取我的奖券' })
  await draw.waitFor()
  await assertMinimumTapHeight(member.page.getByRole('button'), '/lottery controls')
  const box = await draw.boundingBox()
  assert.ok(box, 'the draw button must be laid out')
  assert.ok(
    box.y + box.height <= PHONE.height,
    `the draw button must sit in the first screen, found it at ${Math.round(box.y)}px`,
  )

  await member.page.route(
    '**/lottery**',
    route =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    { times: 1 },
  )
  await draw.click()
  await member.page.getByRole('alert').waitFor()
  await draw.waitFor()
  assert.equal(
    await member.page.getByRole('heading', { name: '这一局掉线了' }).count(),
    0,
    'a failed draw must not replace the page with the fault screen',
  )
  await member.page.unroute('**/lottery**')

  await draw.click()
  const outcome = member.page.locator('[data-outcome]')
  await outcome.waitFor({ timeout: 15_000 })
  await member.page.waitForFunction(
    () => document.querySelectorAll('ol[style*="--stop"]').length === 0,
    undefined,
    { timeout: 15_000 },
  )
  const kind = await outcome.getAttribute('data-outcome')
  assert.ok(['won', 'thanks'].includes(kind), `unexpected draw outcome: ${kind}`)
  assert.equal(
    await member.page.evaluate(() => document.activeElement?.tagName),
    'H2',
    'the revealed prize heading must take focus',
  )
  if (kind === 'won') {
    await member.page.getByRole('img', { name: '用于摊位核销奖品的二维码' }).waitFor()
  }
  await assertNoHorizontalOverflow(member.page, '/lottery result on a phone')

  await member.page.reload()
  await member.page.locator(`[data-outcome="${kind}"]`).waitFor()
  assert.equal(
    await member.page.getByRole('button', { name: '抽取我的奖券' }).count(),
    0,
    'a member must not be offered a second draw',
  )

  await member.page.goto(`${BASE}/me`)
  const wallet = member.page.locator('#stardust-wallet')
  await wallet.waitFor()
  const checkIn = wallet.getByRole('button', { name: /签到/ })
  if (await checkIn.isEnabled()) await checkIn.click()
  await wallet.getByRole('button', { name: '今日已签到' }).waitFor()
  await member.page.waitForFunction(
    () => Number(document.querySelector('#stardust-wallet strong')?.textContent ?? '0') >= 10,
    undefined,
    { timeout: 10_000 },
  )
  await assertNoHorizontalOverflow(member.page, '/me wallet on a phone')

  for (const session of sessions) session.runtimeErrors.assertClean('recruitment lottery browser')
  console.log('PASS  Recruitment lottery draw, reveal and stardust check-in')
} finally {
  for (const session of sessions) {
    session.guard.assertSafe()
    await session.context.close()
  }
  await browser.close()
}
