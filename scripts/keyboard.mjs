import { chromium } from 'playwright'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const page = await ctx.newPage()

await page.goto(`${BASE}/tournaments/2026-nlc`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

await page.keyboard.press('Tab')
const first = await page.evaluate(() => {
  const el = document.activeElement
  return { tag: el?.tagName, text: (el?.textContent ?? '').trim().slice(0, 20), href: el?.getAttribute('href') }
})
check('Skip-to-content link is first', first.href === '#main' || first.text.includes('主内容'), `${first.tag} ${first.href}`)

const focusable = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
  return nodes.filter(n => n.getBoundingClientRect().height > 0).length
})
check('Focusable controls are available', focusable > 5, `${focusable} controls`)

const invisibleFocus = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('a[href],button')].filter(
    n => n.getBoundingClientRect().height > 0,
  )
  let bad = 0
  for (const node of nodes.slice(0, 40)) {
    node.focus()
    const style = getComputedStyle(node)
    const ring =
      style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    const shadow = style.boxShadow !== 'none'
    if (!ring && !shadow) bad += 1
  }
  return bad
})
check('Focused controls have visible indicators', invisibleFocus === 0, `${invisibleFocus} missing indicators`)

const landmarks = await page.evaluate(() => ({
  header: document.querySelectorAll('header').length,
  nav: document.querySelectorAll('nav').length,
  main: document.querySelectorAll('main').length,
  footer: document.querySelectorAll('footer').length,
}))
check('Page landmarks are complete', landmarks.main === 1 && landmarks.nav >= 1 && landmarks.footer === 1, JSON.stringify(landmarks))

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
const scheduleSubmitFocused = await page.getByRole('button', { name: '查看日程' }).evaluate(
  element => element === document.activeElement,
)
check('Tab reaches the schedule filter submit button', scheduleSubmitFocused)
await Promise.all([
  page.waitForURL(url => new URL(url).searchParams.get('team') === selectedTeam),
  page.keyboard.press('Enter'),
])
await page.waitForFunction(team => {
  const links = [...document.querySelectorAll('main a[href*="/matches/"]')]
  return links.length > 0 && links.every(link => link.textContent?.includes(team))
}, selectedTeam)
const keyboardScheduleLinks = page.locator('main a[href^="/tournaments/2026-nlc/matches/"]')
check('Keyboard-filtered schedule exposes match links', (await keyboardScheduleLinks.count()) > 0)
const firstScheduleLink = keyboardScheduleLinks.first()
await page.waitForTimeout(300)
await firstScheduleLink.focus()
const firstScheduleHref = await firstScheduleLink.getAttribute('href')
await page.keyboard.press('Enter')
await page.waitForTimeout(1000)
check(
  'Keyboard opens a schedule match link',
  firstScheduleHref !== null && page.url().endsWith(firstScheduleHref),
  `${firstScheduleHref ?? 'missing link'} → ${page.url().replace(BASE, '')}`,
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
    await page.getByText('还没有往届海报').isVisible().catch(() => false),
  )
}

const mobile = await ctx.newPage()
await mobile.setViewportSize({ width: 390, height: 760 })
await mobile.goto(BASE, { waitUntil: 'domcontentloaded' })
await mobile.waitForTimeout(1000)
await mobile.locator('[aria-controls="site-nav"]').focus()
await mobile.keyboard.press('Enter')
await mobile.waitForTimeout(600)
check('Keyboard opens the mobile drawer', await mobile.locator('#site-nav a').first().isVisible())
check(
  'Drawer exposes its expanded state',
  (await mobile.locator('[aria-controls="site-nav"]').getAttribute('aria-expanded')) === 'true',
)
await mobile.close()

await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
