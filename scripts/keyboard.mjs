import { chromium } from 'playwright'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

const BASE = resolveE2EBaseUrl()
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
})
const outboundGuard = await installLoopbackRequestGuard(ctx)
const page = await ctx.newPage()

await page.goto(`${BASE}/tournaments/2026-nlc`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

await page.keyboard.press('Tab')
const first = await page.evaluate(() => {
  const el = document.activeElement
  return {
    tag: el?.tagName,
    text: (el?.textContent ?? '').trim().slice(0, 20),
    href: el?.getAttribute('href'),
  }
})
check(
  'Skip-to-content link is first',
  first.href === '#main' || first.text.includes('主内容'),
  `${first.tag} ${first.href}`,
)

const focusable = await page.evaluate(() => {
  const nodes = [
    ...document.querySelectorAll(
      'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])',
    ),
  ]
  return nodes.filter(n => {
    const style = getComputedStyle(n)
    return n.getBoundingClientRect().height > 0 && style.visibility !== 'hidden'
  }).length
})
check('Focusable controls are available', focusable > 5, `${focusable} controls`)

const invisibleFocus = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('a[href],button')].filter(n => {
    const style = getComputedStyle(n)
    return n.getBoundingClientRect().height > 0 && style.visibility !== 'hidden'
  })
  let bad = 0
  for (const node of nodes.slice(0, 40)) {
    node.focus()
    const style = getComputedStyle(node)
    const ring = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    const shadow = style.boxShadow !== 'none'
    if (!ring && !shadow) bad += 1
  }
  return bad
})
check(
  'Focused controls have visible indicators',
  invisibleFocus === 0,
  `${invisibleFocus} missing indicators`,
)

const landmarks = await page.evaluate(() => ({
  header: document.querySelectorAll('header').length,
  nav: document.querySelectorAll('nav').length,
  main: document.querySelectorAll('main').length,
  footer: document.querySelectorAll('footer').length,
}))
check(
  'Page landmarks are complete',
  landmarks.main === 1 && landmarks.nav >= 1 && landmarks.footer === 1,
  JSON.stringify(landmarks),
)

await page.goto(`${BASE}/tournaments/2026-nlc/schedule?state=completed&team=FLC`, {
  waitUntil: 'domcontentloaded',
})
const emptyScheduleLink = page.getByRole('link', { name: '查看该队全部赛程' })
const emptyScheduleHref = await emptyScheduleLink.getAttribute('href')
const emptyScheduleUrl = new URL(emptyScheduleHref ?? '', BASE)
check(
  'Empty schedule recovery keeps its team filter',
  emptyScheduleUrl.searchParams.get('state') === 'all' &&
    emptyScheduleUrl.searchParams.get('team') === 'FLC',
  emptyScheduleHref ?? 'missing link',
)
await emptyScheduleLink.focus()
await Promise.all([
  page.waitForURL(
    url => url.searchParams.get('state') === 'all' && url.searchParams.get('team') === 'FLC',
  ),
  page.keyboard.press('Enter'),
])
await page.waitForFunction(() => {
  const state = document.querySelector('select[name="state"]')
  const team = document.querySelector('select[name="team"]')
  return state instanceof HTMLSelectElement && state.value === 'all' && team?.value === 'FLC'
})
const recoveredScheduleLinks = page.locator('main a[href^="/tournaments/2026-nlc/matches/"]')
await recoveredScheduleLinks.first().waitFor()
check(
  'Recovered schedule controls reflect the active filters',
  (await page.locator('select[name="state"]').inputValue()) === 'all' &&
    (await page.locator('select[name="team"]').inputValue()) === 'FLC',
)
check('Recovered team schedule exposes match links', (await recoveredScheduleLinks.count()) > 0)

await page.goto(`${BASE}/tournaments/2026-nlc/schedule`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const scheduleTeamFilter = page.locator('select[name="team"]')
await scheduleTeamFilter.focus()
check(
  'Schedule team filter accepts focus',
  await scheduleTeamFilter.evaluate(element => element === document.activeElement),
)
await page.keyboard.press('f')
const selectedTeam = await scheduleTeamFilter.inputValue()
check('Keyboard changes the schedule team filter', selectedTeam.length > 0, selectedTeam)
await page.keyboard.press('Tab')
const scheduleSubmitFocused = await page
  .getByRole('button', { name: '查看日程' })
  .evaluate(element => element === document.activeElement)
check('Tab reaches the schedule filter submit button', scheduleSubmitFocused)
await Promise.all([
  page.waitForURL(url => new URL(url).searchParams.get('team') === selectedTeam),
  page.keyboard.press('Enter'),
])
// The URL changes before the streamed schedule has replaced its old links.
await page.waitForLoadState('networkidle')
const keyboardScheduleLinks = page.locator('main a[href^="/tournaments/2026-nlc/matches/"]')
check('Keyboard-filtered schedule exposes match links', (await keyboardScheduleLinks.count()) > 0)
const firstScheduleLink = keyboardScheduleLinks.first()
await firstScheduleLink.focus()
const firstScheduleHref = await firstScheduleLink.getAttribute('href')
await Promise.all([
  page.waitForURL(/\/tournaments\/2026-nlc\/matches\/\d+$/),
  page.keyboard.press('Enter'),
])
check(
  'Keyboard opens a schedule match link',
  firstScheduleHref !== null && page.url().endsWith(firstScheduleHref),
  firstScheduleHref ?? 'missing link',
)

await page.goto(`${BASE}/archive`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const firstPoster = page.locator('button[class*="poster"]').first()
if (await firstPoster.count()) {
  await firstPoster.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  const dialogOpen = await page.locator('dialog[open]').count()
  check('Keyboard opens the lightbox', dialogOpen === 1)
  check(
    'Lightbox exposes its active image name',
    (await page.getByRole('dialog', { name: /^赛事影像预览：.+$/ }).count()) === 1,
  )

  const focusInDialog = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    return dialog ? dialog.contains(document.activeElement) : false
  })
  check('Focus moves into the dialog', focusInDialog)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  check('Escape closes the lightbox', (await page.locator('dialog[open]').count()) === 0)

  const returned = await page.evaluate(() => document.activeElement?.tagName)
  check('Focus returns after closing', returned !== 'BODY', String(returned))
} else {
  check(
    'Archive empty state remains keyboard-safe',
    await page
      .getByText(/档案整理中/)
      .isVisible()
      .catch(() => false),
  )
}

const mobile = await ctx.newPage()
await mobile.setViewportSize({ width: 390, height: 760 })
await mobile.goto(BASE, { waitUntil: 'domcontentloaded' })
await mobile.waitForLoadState('networkidle')
await mobile.locator('[aria-controls="site-menu"]').press('Enter')
await mobile.waitForTimeout(600)
check(
  'Keyboard opens the mobile directory',
  await mobile.locator('#site-menu a').first().isVisible(),
)
check(
  'Directory exposes its expanded state',
  (await mobile.locator('[aria-controls="site-menu"]').getAttribute('aria-expanded')) === 'true',
)
check(
  'Focus moves into the directory',
  await mobile
    .locator('#site-menu a')
    .first()
    .evaluate(element => element === document.activeElement),
)
await mobile.keyboard.press('Shift+Tab')
check(
  'Reverse tab reaches the close control',
  await mobile
    .locator('[aria-controls="site-menu"]')
    .evaluate(element => element === document.activeElement),
)
await mobile.keyboard.press('Escape')
await mobile.waitForTimeout(350)
check(
  'Escape closes the directory',
  (await mobile.locator('[aria-controls="site-menu"]').getAttribute('aria-expanded')) === 'false',
)
check(
  'Focus returns to the directory control',
  await mobile
    .locator('[aria-controls="site-menu"]')
    .evaluate(element => element === document.activeElement),
)

await mobile.goto(`${BASE}/tournaments/2026-nlc/register`, { waitUntil: 'domcontentloaded' })
const mobileTabs = mobile.getByRole('navigation', { name: '赛事导航' })
await mobile.waitForFunction(() => document.fonts.status === 'loaded')
await mobile.waitForFunction(() => {
  const rail = document.querySelector('nav[aria-label="赛事导航"]')
  const active = rail?.querySelector('[aria-current="page"]')
  if (!rail || !active) return false

  const railBox = rail.getBoundingClientRect()
  const activeBox = active.getBoundingClientRect()
  return (
    rail.scrollLeft > 1 &&
    activeBox.left >= railBox.left - 2 &&
    activeBox.right <= railBox.right + 2
  )
})
const mobileTabState = await mobileTabs.evaluate(rail => {
  const active = rail.querySelector('[aria-current="page"]')
  return {
    overflow:
      rail.scrollWidth > rail.clientWidth &&
      ['auto', 'scroll'].includes(getComputedStyle(rail).overflowX),
    scrolled: rail.scrollLeft > 1,
    activeCount: rail.querySelectorAll('[aria-current="page"]').length,
    activeHref: active?.getAttribute('href'),
  }
})
check(
  'Mobile tournament navigation exposes a scroll hint',
  await mobile.getByText('左右滑动查看更多').isVisible(),
)
check('Mobile tournament navigation remains horizontally scrollable', mobileTabState.overflow)
check(
  'Mobile tournament navigation reveals its single active tab',
  mobileTabState.scrolled &&
    mobileTabState.activeCount === 1 &&
    mobileTabState.activeHref?.endsWith('/register') === true,
)
await mobile.close()

await browser.close()
outboundGuard.assertSafe()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
