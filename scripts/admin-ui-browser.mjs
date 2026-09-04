import assert from 'node:assert/strict'

import { chromium } from 'playwright'

import { captureBrowserRuntimeErrors } from './browser-runtime-errors.mjs'
import { BROWSER_LEGACY, BROWSER_USERS } from './identity-browser-users.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'
import { assertMinimumTapHeight, assertNoHorizontalOverflow } from './ui-regression-assertions.mjs'

const BASE = resolveE2EBaseUrl()
const routes = [
  ['/admin', '01', '报名与赛果', '现场控制'],
  ['/admin/identity', '02', '资格审核', '成员资格审核'],
  ['/admin/tournaments', '03', '赛事', '赛事档案'],
  ['/admin/games', '04', '项目', '项目库'],
  ['/admin/posts', '05', '动态', '内容台'],
  ['/admin/photos', '06', '素材', '素材库'],
  ['/admin/members', '07', '成员', '成员名册'],
  ['/admin/guestbook', '08', '留言', '留言审核'],
  ['/admin/settings', '09', '设置', '站点设置'],
]

async function login(page) {
  await page.goto(`${BASE}/login?redirectKey=workspaces`)
  await page.getByLabel('用户名').fill(BROWSER_USERS.owner.username)
  await page.getByLabel('密码').fill(BROWSER_USERS.owner.password)
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/login'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
  extraHTTPHeaders: { 'x-real-ip': '198.51.100.48' },
})
const guard = await installLoopbackRequestGuard(context)
const page = await context.newPage()
const runtimeErrors = captureBrowserRuntimeErrors(page)

try {
  await login(page)
  for (const [path, index, label, heading] of routes) {
    await page.goto(BASE + path)
    await page.getByRole('heading', { name: heading, exact: true }).waitFor()
    const activeLink = page
      .getByRole('navigation', { name: '后台导航' })
      .getByRole('link', { name: label, exact: true })
    assert.equal(await activeLink.getAttribute('aria-current'), 'page')
    assert.match((await activeLink.textContent()) ?? '', new RegExp(`^\\s*${index}`))
    await assertNoHorizontalOverflow(page, path)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ['/admin', '/admin/identity']) {
    await page.goto(BASE + path)
    await assertNoHorizontalOverflow(page, `${path} at 390px`)
  }
  await assertMinimumTapHeight(
    page.getByRole('navigation', { name: '后台导航' }).locator('a'),
    'mobile admin navigation',
    44,
  )

  await page.goto(`${BASE}/admin/tournaments/${BROWSER_LEGACY.tournamentId}/check-in`)
  await page.getByRole('heading', { name: '现场签到', exact: true }).waitFor()
  await page.getByRole('button', { name: '刷新名单', exact: true }).waitFor()
  await assertNoHorizontalOverflow(page, 'mobile check-in desk')
  runtimeErrors.assertClean('admin UI smoke')
  console.log('PASS  admin routes, numbering, responsive layout and check-in refresh')
} finally {
  guard.assertSafe()
  await context.close()
  await browser.close()
}
