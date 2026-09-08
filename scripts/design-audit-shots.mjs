import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { BROWSER_USERS } from './identity-browser-users.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const base = resolveE2EBaseUrl()
const outputDirectory = new URL('../output/design-audit/', import.meta.url)
const publicRoutes = [
  ['home', '/'],
  ['tournaments', '/tournaments'],
  ['tournament-detail', '/tournaments/2026-nlc'],
  ['tournament-schedule', '/tournaments/2026-nlc/schedule?state=all'],
  ['tournament-teams', '/tournaments/2026-nlc/teams'],
  ['tournament-bracket', '/tournaments/2026-nlc/bracket'],
  ['tournament-results', '/tournaments/2026-nlc/results'],
  ['games', '/games'],
  ['game-detail', '/games/cs2'],
  ['archive', '/archive'],
  ['archive-merit', '/archive/merit'],
  ['news', '/news'],
  ['about', '/about'],
  ['guestbook', '/guestbook'],
  ['search', '/search'],
  ['login', '/login'],
]
const authenticatedRoutes = [
  ['me', '/me'],
  ['account', '/account'],
  ['account-security', '/account/security'],
  ['admin-console', '/admin'],
  ['admin-identity', '/admin/identity'],
  ['admin-tournaments', '/admin/tournaments'],
  ['admin-photos', '/admin/photos'],
  ['admin-settings', '/admin/settings'],
]
const viewports = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]

async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      const iterations = animation.effect?.getComputedTiming().iterations ?? 1
      if (Number.isFinite(iterations)) animation.finish()
      else {
        animation.pause()
        animation.currentTime = 0
      }
    }
    for (const element of document.querySelectorAll('[data-rise]')) {
      element.style.setProperty('opacity', '1', 'important')
      element.style.setProperty('transform', 'none', 'important')
    }
  })
  await page.waitForTimeout(300)
}

async function signIn(page) {
  await page.goto(`${base}/login?redirectKey=workspaces`, { waitUntil: 'networkidle' })
  await page.getByLabel('用户名').fill(BROWSER_USERS.owner.username)
  await page.getByLabel('密码', { exact: true }).fill(BROWSER_USERS.owner.password)
  await Promise.all([
    page.waitForURL(url => url.pathname !== '/login'),
    page.getByRole('button', { name: '使用账号密码登录' }).click(),
  ])
}

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch()
const failures = []

async function capture(page, routes, label) {
  for (const [name, path] of routes) {
    const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })
    if (!response || !response.ok()) {
      failures.push(`${label} ${path}: status ${response ? response.status() : 'none'}`)
      continue
    }
    await settle(page)
    await page.screenshot({
      path: fileURLToPath(new URL(`${name}-${label}.png`, outputDirectory)),
      fullPage: true,
    })
    console.log(`captured ${name} (${label})`)
  }
}

for (const [label, viewport] of viewports) {
  for (const [routes, authenticated] of [
    [publicRoutes, false],
    [authenticatedRoutes, true],
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
      ...(authenticated ? { extraHTTPHeaders: { 'x-real-ip': '198.51.100.48' } } : {}),
    })
    const guard = await installLoopbackRequestGuard(context)
    const page = await context.newPage()
    page.on('pageerror', error => failures.push(`${label} pageerror: ${error.message}`))

    if (authenticated) await signIn(page)
    await capture(page, routes, label)

    await guard.dispose?.()
    await context.close()
  }
}

await browser.close()
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
}
