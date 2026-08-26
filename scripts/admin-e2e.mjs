import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const token = readFileSync('/tmp/dev-token.txt', 'utf8').trim()
const db = sql =>
  execSync(
    `docker compose exec -T db psql -U postgres -d cs2cup -Atc "${sql}"`,
    { encoding: 'utf8', cwd: '/Users/m1ng/code/internet/cs2cup' },
  ).trim()

const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addCookies([{ name: 'cs2cup_session', value: token, url: BASE }])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

const stamp = Date.now()

await page.goto(`${BASE}/admin/posts`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const before = Number(db('select count(*) from post'))
await page.fill('#np-slug', `e2e-${stamp}`)
await page.fill('#np-title', 'E2E 测试公告')
await page.fill('#np-summary', '由端到端测试创建')
await page.fill('#np-body', '正文内容')
await page.locator('form:has(#np-slug) button[type=submit]').click()
await page.waitForTimeout(2500)
const after = Number(db('select count(*) from post'))
check('后台发布动态入库', after === before + 1, `${before} → ${after}`)

await page.goto(`${BASE}/news/e2e-${stamp}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const liveText = await page.evaluate(() => document.body.innerText)
check('新动态在前台可见', liveText.includes('E2E 测试公告'), liveText.slice(0, 40).replace(/\n/g, ' '))

await page.goto(`${BASE}/admin/games`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.locator('main').getByRole('button', { name: '编辑' }).first().click()
await page.waitForTimeout(600)
const newTagline = `测试标语 ${stamp}`
const editor = page.locator('main form').filter({ has: page.getByRole('button', { name: '保存' }) })
await editor.locator('input[name=tagline]').fill(newTagline)
await editor.getByRole('button', { name: '保存' }).click()
await page.waitForTimeout(2500)
const saved = db(`select tagline from game order by sort_order limit 1`)
check('后台编辑项目入库', saved === newTagline, saved)

await page.goto(`${BASE}/admin/tournaments`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const tBefore = Number(db('select count(*) from tournament'))
await page.fill('#nt-slug', `e2e-cup-${stamp}`)
await page.fill('#nt-title', 'E2E 测试杯')
await page.fill('#nt-season', '2099')
await page.fill('#nt-edition', '99')
await page.locator('form:has(#nt-slug) button[type=submit]').click()
await page.waitForTimeout(2500)
const tAfter = Number(db('select count(*) from tournament'))
check('后台新建赛事入库', tAfter === tBefore + 1, `${tBefore} → ${tAfter}`)

const anon = await browser.newContext()
const anonPage = await anon.newPage()
const res = await anonPage.request.get(`${BASE}/admin/posts`, { maxRedirects: 0 })
check('未登录访问后台被拒', res.status() === 307, String(res.status()))
await anon.close()

check('无页面异常', errors.length === 0, errors.slice(0, 1).join())

db(`delete from post where slug like 'e2e-%'`)
db(`delete from tournament where slug like 'e2e-cup-%'`)
db(`update game set tagline='社团的主战场,宁理杯已经办到第四届。' where slug='cs2'`)

await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (failed) process.exit(1)
