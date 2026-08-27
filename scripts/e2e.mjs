import { chromium } from 'playwright'

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const errors = []
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
check('Home page loads', await page.locator('h1').first().isVisible())
const tabIcon = await page.locator('link[rel~="icon"]').first().getAttribute('href')
check(
  'Tab icon uses the current club logo',
  tabIcon?.includes('/brand/club-logo.jpg') === true,
  tabIcon ?? 'missing',
)

const gameLinks = await page.locator('a[href^="/games/"]').count()
check('Home page lists games', gameLinks >= 3, `${gameLinks} games`)

await page.goto(`${BASE}/games/lol`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const lolEmpty = await page.getByText('这个项目还没有办过比赛').isVisible().catch(() => false)
check('Empty game page provides guidance', lolEmpty)

await page.goto(`${BASE}/tournaments/2026-nlc`, { waitUntil: 'domcontentloaded' })
const tournamentNav = page.getByRole('navigation', { name: '赛事导航' })
const scheduleTab = tournamentNav.getByRole('link', { name: '赛程' })
check(
  'Tournament navigation links to schedule',
  (await scheduleTab.getAttribute('href')) === '/tournaments/2026-nlc/schedule',
)
await scheduleTab.click()
await page.waitForURL(/\/tournaments\/2026-nlc\/schedule$/, { timeout: 15000 }).catch(() => {})
check('Schedule route is reachable', page.url().endsWith('/tournaments/2026-nlc/schedule'))
check(
  'Schedule tab identifies the current page',
  (await scheduleTab.getAttribute('aria-current')) === 'page',
)

await page.goto(`${BASE}/tournaments/2026-nlc/schedule?state=all`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const scheduleLinks = page.locator('main a[href^="/tournaments/2026-nlc/matches/"]')
const scheduleLinkCount = await scheduleLinks.count()
check('Schedule ledger lists matches', scheduleLinkCount === 15, `${scheduleLinkCount} matches`)
const scheduledTimes = await scheduleLinks.locator('time[datetime]').evaluateAll(nodes =>
  nodes.map(node => Date.parse(node.getAttribute('datetime') ?? '')),
)
const chronological =
  scheduledTimes.length === scheduleLinkCount &&
  scheduledTimes.every(Number.isFinite) &&
  scheduledTimes.every((time, index) => index === 0 || scheduledTimes[index - 1] <= time)
check('Schedule ledger is chronological', chronological, `${scheduledTimes.length} scheduled matches`)

await page.locator('select[name="team"]').selectOption('FROST')
await page.getByRole('button', { name: '查看日程' }).click()
await page.waitForURL(url => new URL(url).searchParams.get('team') === 'FROST')
const filteredScheduleUrl = new URL(page.url())
check(
  'Team filter uses a readable tag in the URL',
  filteredScheduleUrl.searchParams.get('team') === 'FROST',
  `${filteredScheduleUrl.pathname}${filteredScheduleUrl.search}`,
)
const filteredScheduleLinks = page.locator('main a[href^="/tournaments/2026-nlc/matches/"]')
const filteredScheduleText = await filteredScheduleLinks.allTextContents()
check(
  'Team filter limits the schedule ledger',
  filteredScheduleText.length > 0 && filteredScheduleText.every(text => text.includes('FROST')),
  `${filteredScheduleText.length} matches`,
)

await page.goto(`${BASE}/tournaments/2026-nlc/teams`, { waitUntil: 'domcontentloaded' })
const teamCards = await page.locator('main a[href*="/teams/"]').count()
check('Team list renders', teamCards === 16, `${teamCards} teams`)

await page.goto(`${BASE}/tournaments/2026-nlc/bracket`, { waitUntil: 'domcontentloaded' })
const matchLinks = await page.locator('main a[href*="/matches/"]').count()
check('Bracket matches are linked', matchLinks >= 15, `${matchLinks} matches`)

await page.locator('main a[href*="/matches/"]').first().click()
await page.waitForURL(/\/matches\/\d+/, { timeout: 15000 }).catch(() => {})
check('Match detail is reachable', /\/matches\/\d+/.test(page.url()), page.url().split('/').pop())
await page.waitForTimeout(800)
const hasVeto = await page.getByText('Ban / Pick').isVisible().catch(() => false)
check('Ban/pick section renders', hasVeto)
check('Pick rows identify the selecting team', await page.getByText(/PICK · /).first().isVisible().catch(() => false))

await page.goto(`${BASE}/archive`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const posters = await page.locator('button[class*="poster"]').count()
if (posters > 0) {
  check('Archive lists images', true, `${posters} images`)
  await page.locator('button[class*="poster"]').first().click()
  await page.waitForTimeout(600)
  const lbOpen = await page.locator('dialog[open]').isVisible().catch(() => false)
  check('Lightbox opens', lbOpen)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const lbClosed = (await page.locator('dialog[open]').count()) === 0
  check('Escape closes the lightbox', lbClosed)
} else {
  check('Archive empty state renders', await page.getByText('还没有往届海报').isVisible().catch(() => false))
}

await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
check('Unauthenticated admin access is rejected', page.url().includes('/admin/login'), page.url().replace(BASE, ''))

await ctx.addCookies([{ name: 'cs2cup_session', value: 'forged.token.here', url: BASE }])
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
check('Forged session cookie is rejected', page.url().includes('/admin/login'))
await ctx.clearCookies()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const m = await ctx.newPage()
await m.setViewportSize({ width: 390, height: 760 })
await m.goto(BASE, { waitUntil: 'domcontentloaded' })
await m.waitForTimeout(800)
await m.click('[aria-label="打开导航"]')
await m.waitForTimeout(600)
const drawer = await m.locator('#site-nav a').first().isVisible()
check('Mobile navigation drawer opens', drawer)
const noOverflow = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
check('Mobile page has no horizontal overflow', noOverflow)
await m.goto(`${BASE}/tournaments/2026-nlc/results`, { waitUntil: 'domcontentloaded' })
await m.waitForTimeout(1000)
const mobileReportLink = m.getByRole('link', { name: '战报 →' }).first()
const reportBox = await mobileReportLink.boundingBox()
const reportLinkVisible = reportBox
  ? reportBox.x >= 0 &&
    reportBox.x + reportBox.width <= 390 &&
    reportBox.y >= 0 &&
    reportBox.y + reportBox.height <= 760
  : false
check('Mobile match-report link is visible without scrolling', reportLinkVisible, reportBox ? `${Math.round(reportBox.x)},${Math.round(reportBox.y)}` : 'missing')
await m.goto(`${BASE}/tournaments/2026-nlc/schedule?state=all`, { waitUntil: 'domcontentloaded' })
await m.waitForTimeout(1000)
const mobileScheduleForm = m.locator('main form')
await mobileScheduleForm.scrollIntoViewIfNeeded()
const mobileScheduleOverflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
check('Mobile schedule has no horizontal overflow', !mobileScheduleOverflow)
const mobileScheduleControls = mobileScheduleForm.locator('select, button, a')
const mobileControlCount = await mobileScheduleControls.count()
const mobileControlsVisible = await mobileScheduleControls.evaluateAll(nodes =>
  nodes.every(node => {
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    return (
      rect.width > 0 &&
      rect.height >= 44 &&
      rect.left >= 0 &&
      rect.right <= window.innerWidth &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    )
  }),
)
check(
  'Mobile schedule controls are visible',
  mobileControlCount === 4 && mobileControlsVisible,
  `${mobileControlCount} controls`,
)
await m.goto(`${BASE}/tournaments/2026-nlc/rules`, { waitUntil: 'domcontentloaded' })
await m.evaluate(() => document.fonts.ready)
await m.waitForTimeout(100)
const mobileTournamentNav = m.getByRole('navigation', { name: '赛事导航' })
const activeTournamentTab = mobileTournamentNav.locator('[aria-current="page"]')
const [navBox, activeTabBox, tournamentNavScroll] = await Promise.all([
  mobileTournamentNav.boundingBox(),
  activeTournamentTab.boundingBox(),
  mobileTournamentNav.evaluate(element => element.scrollLeft),
])
const activeTabVisible = navBox && activeTabBox
  ? activeTabBox.x >= navBox.x && activeTabBox.x + activeTabBox.width <= navBox.x + navBox.width
  : false
check(
  'Mobile tournament navigation reveals the active tab',
  activeTabVisible && tournamentNavScroll > 0,
  `scroll ${Math.round(tournamentNavScroll)}`,
)
await m.close()

await page.goto(`${BASE}/tournaments/2026-nlc/teams/FROST`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('Team page includes match history', await page.getByText('赛程与战绩').isVisible().catch(() => false))
check('Team page includes map statistics', await page.getByText('Ban/Pick 倾向').isVisible().catch(() => false))

await page.goto(`${BASE}/tournaments/2026-nlc/results`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('Results page includes map statistics', await page.getByText('哪张图最常打').isVisible().catch(() => false))

await page.goto(`${BASE}/news`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const newsLinks = await page.locator('main a[href^="/news/"]').count()
check('News entries are linked', newsLinks >= 3, `${newsLinks} entries`)
await page.locator('main a[href^="/news/"]').first().click()
await page.waitForURL(/\/news\/.+/, { timeout: 15000 }).catch(() => {})
check('News detail is reachable', /\/news\/.+/.test(page.url()))

for (const path of ['/sitemap.xml', '/robots.txt', '/feed.xml']) {
  const res = await page.request.get(BASE + path)
  check(`${path} is available`, res.status() === 200, String(res.status()))
}

await page.goto(`${BASE}/search?q=` + encodeURIComponent('宁理'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const hits = await page.locator('main a[class*="hit"]').count()
check('Search returns results', hits > 0, `${hits} hits`)

await page.goto(`${BASE}/search?q=zzzznope`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
check('Empty search shows guidance', (await page.evaluate(() => document.body.innerText)).includes('没有匹配'))

const rpc = await page.request.post('http://localhost:53000/rpc/submit_team', {
  headers: { 'Content-Type': 'application/json' },
  data: { payload: { slug: '2026-nlc', name: 'x', tag: 'XX', captain: 'x', contact: 'y' } },
  failOnStatusCode: false,
})
check('Anonymous registration RPC access is rejected', rpc.status() === 401, String(rpc.status()))

check('Browser console has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
