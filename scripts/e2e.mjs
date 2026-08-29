import { randomBytes } from 'node:crypto'
import { chromium } from 'playwright'
import postgres from 'postgres'

const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const cacheDirectives = response => {
  const value = response.headers()['cache-control'] ?? ''
  return {
    value: value || '(missing)',
    directives: value
      .toLowerCase()
      .split(',')
      .map(directive => directive.trim())
      .filter(Boolean),
  }
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
await page.waitForURL(url => url.pathname === '/admin/login', { timeout: 15000 }).catch(() => {})
check(
  'Unauthenticated admin access redirects to the application login',
  new URL(page.url()).pathname === '/admin/login' &&
    await page.getByRole('heading', { name: '后台登录' }).isVisible().catch(() => false),
  new URL(page.url()).pathname,
)

await ctx.addCookies([{ name: 'cs2cup_session', value: 'retired-cookie', url: BASE }])
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForURL(url => url.pathname === '/admin/login', { timeout: 15000 }).catch(() => {})
check(
  'Retired application session cookies grant no access',
  new URL(page.url()).pathname === '/admin/login' &&
    await page.getByRole('heading', { name: '后台登录' }).isVisible().catch(() => false),
  new URL(page.url()).pathname,
)
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
check('Published news entries are linked', newsLinks >= 2, `${newsLinks} entries`)
await page.locator('main a[href^="/news/"]').first().click()
await page.waitForURL(/\/news\/.+/, { timeout: 15000 }).catch(() => {})
check('News detail is reachable', /\/news\/.+/.test(page.url()))

let feedResponse
for (const path of ['/sitemap.xml', '/robots.txt', '/feed.xml']) {
  const res = await page.request.get(BASE + path)
  check(`${path} is available`, res.status() === 200, String(res.status()))
  if (path === '/feed.xml') feedResponse = res
}

const feedCache = cacheDirectives(feedResponse)
check(
  'Public feed uses shared bounded revalidation',
  feedCache.directives.includes('s-maxage=300') &&
    !feedCache.directives.includes('private') &&
    !feedCache.directives.includes('no-store') &&
    !feedResponse.headers()['set-cookie'],
  feedCache.value,
)

const livePublicRoutes = [
  '/search?q=cache-boundary-probe',
  '/tournaments/2026-nlc',
  '/tournaments/2026-nlc/register',
  '/tournaments/2026-nlc/schedule?state=all',
]
const liveCacheFailures = []
for (const path of livePublicRoutes) {
  const response = await page.request.get(`${BASE}${path}`)
  const cache = cacheDirectives(response)
  if (
    response.status() !== 200 ||
    !cache.directives.includes('no-store') ||
    cache.directives.some(directive => directive.startsWith('s-maxage='))
  ) {
    liveCacheFailures.push(`${path}:${response.status()}:${cache.value}`)
  }
}
check(
  'Live and high-cardinality public routes are never shared-cacheable',
  liveCacheFailures.length === 0,
  liveCacheFailures.join(', '),
)

await page.goto(`${BASE}/search?q=` + encodeURIComponent('宁理'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const hits = await page.locator('main a[class*="hit"]').count()
check('Search returns results', hits > 0, `${hits} hits`)

await page.goto(`${BASE}/search?q=zzzznope`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
check('Empty search shows guidance', (await page.evaluate(() => document.body.innerText)).includes('没有匹配'))

const databaseUrl = process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://postgres:dev@127.0.0.1:55432/cs2cup'
const fixtureDatabase = postgres(databaseUrl, {
  max: 1,
  fetch_types: false,
  connect_timeout: 5,
  idle_timeout: 5,
})
const registrationSuffix = randomBytes(6).toString('hex')
const registrationSlug = `e2e-registration-${registrationSuffix}`
const registrationName = `端测-${randomBytes(4).toString('hex')}`
const registrationTag = `E${randomBytes(2).toString('hex')}`
const ipBytes = randomBytes(2)
const registrationIp = `198.18.${ipBytes[0]}.${ipBytes[1]}`
let registrationTournamentId = null

try {
  const fixtures = await fixtureDatabase`
    insert into public.tournament (
      slug, title, game_id, season, edition, status, team_cap, hero_bottom
    )
    select
      ${registrationSlug},
      'E2E 报名语义验证',
      game.id,
      'E2E',
      9000,
      'registration',
      4,
      'E2E 报名语义验证'
    from public.game game
    where game.slug = 'cs2'
    returning id
  `
  registrationTournamentId = fixtures[0]?.id ?? null
  if (registrationTournamentId === null) {
    throw new Error('Registration E2E fixture tournament was not created')
  }

  await ctx.setExtraHTTPHeaders({ 'x-real-ip': registrationIp })
  await page.goto(`${BASE}/tournaments/${registrationSlug}/register`, {
    waitUntil: 'domcontentloaded',
  })

  const registrationForm = page.locator('main form')
  await registrationForm.waitFor({ state: 'visible' })
  check(
    'Registration is exercised through the application form',
    true,
  )

  const fillRegistration = async () => {
    await registrationForm.locator('[name="name"]').fill(registrationName)
    await registrationForm.locator('[name="tag"]').fill(registrationTag)
    await registrationForm.locator('[name="captain"]').fill('E2E 队长')
    await registrationForm.locator('[name="contact"]').fill('e2e-contact')
    await registrationForm.locator('[name="player1"]').fill('e2e-player')
  }
  const submitRegistration = async () => {
    await fillRegistration()
    const submitted = page.waitForResponse(response => {
      const request = response.request()
      return request.method() === 'POST' &&
        new URL(response.url()).pathname === `/tournaments/${registrationSlug}/register`
    })
    await registrationForm.getByRole('button', { name: '提交报名' }).click()
    return submitted
  }

  const successResponse = await submitRegistration()
  await page.getByRole('status').getByText('报名已提交').waitFor({ state: 'visible' })
  check(
    'Registration form reports a successful application submission',
    successResponse.ok(),
    String(successResponse.status()),
  )
  const seatsAfterSuccess = page.getByText('还剩 3 / 4 个席位')
  await seatsAfterSuccess.waitFor({ state: 'visible' }).catch(() => {})
  check(
    'Successful registration consumes exactly one seat',
    await seatsAfterSuccess.isVisible().catch(() => false),
  )

  await submitRegistration()
  const duplicateError = page.getByText('战队名称或 TAG 已被占用')
  await duplicateError.waitFor({ state: 'visible' })
  await submitRegistration()
  await duplicateError.waitFor({ state: 'visible' })
  check(
    'Rejected duplicate submissions do not consume another seat',
    await duplicateError.isVisible() &&
      await seatsAfterSuccess.isVisible().catch(() => false),
  )

  const limitedResponse = await submitRegistration()
  const rateLimitError = page.getByText(/提交太频繁。每 60 分钟最多尝试 3 次/)
  await rateLimitError.waitFor({ state: 'visible' })
  check(
    'Registration rate limit is enforced through the application form',
    limitedResponse.ok() && await rateLimitError.isVisible(),
    String(limitedResponse.status()),
  )
} finally {
  await ctx.setExtraHTTPHeaders({})
  if (registrationTournamentId !== null) {
    await fixtureDatabase`
      delete from public.tournament
      where id = ${registrationTournamentId}::bigint
    `
  }
  await fixtureDatabase.end({ timeout: 5 })
}

check('Browser console has no errors', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
