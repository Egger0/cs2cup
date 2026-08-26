import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
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
check('首页加载', await page.locator('h1').first().isVisible())

const gameLinks = await page.locator('a[href^="/games/"]').count()
check('首页列出游戏项目', gameLinks >= 3, `${gameLinks} 个`)

await page.goto(`${BASE}/games/lol`, { waitUntil: 'domcontentloaded' })
const lolEmpty = await page.getByText('这个项目还没有办过比赛').isVisible().catch(() => false)
check('空项目页有引导', lolEmpty)

await page.goto(`${BASE}/tournaments/2026-nlc/teams`, { waitUntil: 'domcontentloaded' })
const teamCards = await page.locator('main a[href*="/teams/"]').count()
check('战队列表渲染', teamCards === 16, `${teamCards} 支`)

await page.goto(`${BASE}/tournaments/2026-nlc/bracket`, { waitUntil: 'domcontentloaded' })
const matchLinks = await page.locator('main a[href*="/matches/"]').count()
check('对阵表可点击', matchLinks >= 15, `${matchLinks} 场`)

await page.locator('main a[href*="/matches/"]').first().click()
await page.waitForURL(/\/matches\/\d+/, { timeout: 15000 }).catch(() => {})
check('比赛详情可达', /\/matches\/\d+/.test(page.url()), page.url().split('/').pop())
await page.waitForTimeout(800)
const hasVeto = await page.getByText('Ban / Pick').isVisible().catch(() => false)
check('BP 区块渲染', hasVeto)

await page.goto(`${BASE}/archive`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)
const posters = await page.locator('button[class*="poster"]').count()
check('存档页有图', posters === 10, `${posters} 张`)
await page.locator('button[class*="poster"]').first().click()
await page.waitForTimeout(600)
const lbOpen = await page.locator('dialog[open]').isVisible().catch(() => false)
check('灯箱可打开', lbOpen)
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
const lbClosed = (await page.locator('dialog[open]').count()) === 0
check('Esc 可关闭灯箱', lbClosed)

await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
check('未登录后台被拦截', page.url().includes('/admin/login'), page.url().replace(BASE, ''))

await ctx.addCookies([{ name: 'cs2cup_session', value: 'forged.token.here', url: BASE }])
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
check('伪造 cookie 被拒', page.url().includes('/admin/login'))
await ctx.clearCookies()

const m = await ctx.newPage()
await m.setViewportSize({ width: 390, height: 760 })
await m.goto(BASE, { waitUntil: 'domcontentloaded' })
await m.waitForTimeout(800)
await m.click('[aria-label="打开导航"]')
await m.waitForTimeout(600)
const drawer = await m.locator('#site-nav a').first().isVisible()
check('移动端抽屉可开', drawer)
const noOverflow = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
check('移动端无横向溢出', noOverflow)
await m.close()

await page.goto(`${BASE}/tournaments/2026-nlc/teams/FROST`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('战队主页有战绩', await page.getByText('打过的比赛').isVisible().catch(() => false))
check('战队主页有地图统计', await page.getByText('Ban/Pick 倾向').isVisible().catch(() => false))

await page.goto(`${BASE}/tournaments/2026-nlc/results`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('战报页有地图数据', await page.getByText('哪张图最常打').isVisible().catch(() => false))

await page.goto(`${BASE}/news`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
const newsLinks = await page.locator('main a[href^="/news/"]').count()
check('动态列表可点击', newsLinks >= 3, `${newsLinks} 条`)
await page.locator('main a[href^="/news/"]').first().click()
await page.waitForURL(/\/news\/.+/, { timeout: 15000 }).catch(() => {})
check('动态详情可达', /\/news\/.+/.test(page.url()))

for (const path of ['/sitemap.xml', '/robots.txt', '/feed.xml']) {
  const res = await page.request.get(BASE + path)
  check(`${path} 可用`, res.status() === 200, String(res.status()))
}

await page.goto(`${BASE}/search?q=` + encodeURIComponent('宁理'), { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const hits = await page.locator('main a[class*="hit"]').count()
check('搜索有结果', hits > 0, `${hits} 条`)

await page.goto(`${BASE}/search?q=zzzznope`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
check('搜索空结果有提示', (await page.evaluate(() => document.body.innerText)).includes('没有匹配'))

const rpc = await page.request.post('http://localhost:53000/rpc/submit_team', {
  headers: { 'Content-Type': 'application/json' },
  data: { payload: { slug: '2026-nlc', name: 'x', tag: 'XX', captain: 'x', contact: 'y' } },
  failOnStatusCode: false,
})
check('匿名无法直接调用报名接口', rpc.status() === 401, String(rpc.status()))

check('控制台无错误', errors.length === 0, errors.slice(0, 2).join(' | '))

await browser.close()
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)
