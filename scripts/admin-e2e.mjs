import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const token = readFileSync(process.env.DEV_TOKEN_FILE ?? '/tmp/dev-token.txt', 'utf8').trim()
const db = sql =>
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'cs2cup',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      sql,
    ],
    { encoding: 'utf8', cwd: ROOT },
  ).trim()
const sqlString = value => `'${value.replaceAll("'", "''")}'`

const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
})
await ctx.addCookies([{ name: 'cs2cup_session', value: token, url: BASE }])
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

const stamp = Date.now()
let originalTagline = null

try {
  await page.goto(`${BASE}/admin/posts`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  const before = Number(db('select count(*) from post'))
  await page.fill('#np-slug', `e2e-${stamp}`)
  await page.fill('#np-title', 'E2E test announcement')
  await page.fill('#np-summary', 'Created by the end-to-end suite')
  await page.fill('#np-body', 'Test body')
  await page.locator('form:has(#np-slug) button[type=submit]').click()
  await page.waitForTimeout(2500)
  const after = Number(db('select count(*) from post'))
  check('Admin creates a news entry', after === before + 1, `${before} → ${after}`)

  await page.goto(`${BASE}/news/e2e-${stamp}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1500)
  const liveText = await page.evaluate(() => document.body.innerText)
  check('New entry is visible publicly', liveText.includes('E2E test announcement'))

  await page.goto(`${BASE}/admin/games`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  originalTagline = db('select tagline from game order by sort_order limit 1')
  await page.locator('main').getByRole('button', { name: '编辑' }).first().click()
  await page.waitForTimeout(600)
  const newTagline = `E2E tagline ${stamp}`
  const editor = page
    .locator('main form')
    .filter({ has: page.getByRole('button', { name: '保存' }) })
  await editor.locator('input[name=tagline]').fill(newTagline)
  await editor.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(2500)
  const saved = db(`select tagline from game order by sort_order limit 1`)
  check('Admin updates a game', saved === newTagline, saved)

  await page.goto(`${BASE}/admin/tournaments`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1000)
  const tBefore = Number(db('select count(*) from tournament'))
  await page.fill('#nt-slug', `e2e-cup-${stamp}`)
  await page.fill('#nt-title', 'E2E Test Cup')
  await page.fill('#nt-season', '2099')
  await page.fill('#nt-edition', '99')
  await page.locator('form:has(#nt-slug) button[type=submit]').click()
  await page.waitForTimeout(2500)
  const tAfter = Number(db('select count(*) from tournament'))
  check('Admin creates a tournament', tAfter === tBefore + 1, `${tBefore} → ${tAfter}`)

  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  const res = await anonPage.request.get(`${BASE}/admin/posts`, {
    maxRedirects: 0,
  })
  check('Unauthenticated admin access is rejected', res.status() === 307, String(res.status()))
  await anon.close()

  // Upload media.
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABGCAYAAAA2Vh8vAAAAJUlEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAA4M0AKvgAAY0jZuQAAAAASUVORK5CYII=',
    'base64',
  )
  mkdirSync('/tmp/e2e-upload', { recursive: true })
  writeFileSync('/tmp/e2e-upload/probe.png', png)

  await page.goto(`${BASE}/admin/photos`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const photosBefore = Number(db('select count(*) from photo'))
  await page.setInputFiles('input[type=file]', '/tmp/e2e-upload/probe.png')
  await page.fill('#up-caption', 'E2E upload probe')
  await page.locator('main form').getByRole('button', { name: '上传' }).click()
  await page.waitForTimeout(3000)
  const photosAfter = Number(db('select count(*) from photo'))
  check('Admin uploads media', photosAfter === photosBefore + 1, `${photosBefore} → ${photosAfter}`)

  const key = db(`select storage_key from photo where caption='E2E upload probe'`)
  const served = await page.request.get(`${BASE}/media/${key}`)
  check('Uploaded media is served over HTTP', served.status() === 200, `${served.status()} ${key}`)
  const dims = db(`select width||'x'||height from photo where caption='E2E upload probe'`)
  check('Uploaded dimensions are detected', dims === '100x70', dims)

  // Generate the bracket.
  await page.goto(`${BASE}/admin/tournaments/4`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1200)
  const beforeMatches = Number(db('select count(*) from match where tournament_id=4'))
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: /生成对阵表|重新抽签/ }).click()
  await page.waitForTimeout(6000)
  const afterMatches = Number(db('select count(*) from match where tournament_id=4'))
  check('Admin generates a bracket', afterMatches === 15, `${beforeMatches} → ${afterMatches}`)
  const linked = Number(
    db('select count(*) from match where tournament_id=4 and source_match_a_id is not null'),
  )
  check('Bracket progression is linked', linked === 7, String(linked))
  const seeded = Number(
    db('select count(*) from match where tournament_id=4 and round=0 and team_a_id is not null'),
  )
  check('Opening round follows seed placement', seeded === 8, String(seeded))

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const reportLink = page.getByRole('link', { name: '编辑战报 →' }).first()
  check('Resolved matches link to report editing', await reportLink.isVisible())
  await reportLink.click()
  await page.waitForTimeout(1200)
  check(
    'Match report editor loads',
    (await page.getByRole('heading', { level: 1 }).isVisible()) &&
      (await page.getByRole('button', { name: '保存战报' }).isVisible()),
  )

  const reportMatchId = Number(new URL(page.url()).pathname.split('/').at(-1))
  await page.getByRole('button', { name: '添加记录' }).click()
  const reportRow = page.locator('ol li').last()
  await reportRow.getByLabel('操作').selectOption('pick')
  await reportRow.getByLabel('执行方').selectOption('a')
  await reportRow.getByLabel('已进行').check()
  await reportRow.locator('input[type=number]').nth(0).fill('13')
  await reportRow.locator('input[type=number]').nth(1).fill('8')
  await page.getByRole('button', { name: '保存战报' }).click()
  await page.waitForTimeout(2500)
  const savedReport = db(
    `select count(*)||':'||coalesce(max(m.score_a),-1)||':'||coalesce(max(m.score_b),-1) from match_map mm join match m on m.id=mm.match_id where mm.match_id=${reportMatchId}`,
  )
  check('Map report persists and updates the series score', savedReport === '1:1:0', savedReport)

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const scoreForm = page
    .locator(`a[href$="/matches/${reportMatchId}"]`)
    .locator('xpath=ancestor::form')
  await scoreForm.locator('input[name=scoreA]').fill('1')
  await scoreForm.locator('input[name=scoreB]').fill('0')
  await scoreForm.getByRole('button', { name: '保存 BO3' }).click()
  await page.waitForTimeout(1800)
  const reportPreserved = Number(
    db(`select count(*) from match_map where match_id=${reportMatchId}`),
  )
  const scoreError = await page.getByText('本场已有逐图战报，请在战报编辑器中修改比分').isVisible()
  check(
    'Quick score entry preserves map reports',
    scoreError && reportPreserved === 1,
    String(reportPreserved),
  )

  // Record the champion.
  await page.goto(`${BASE}/admin/tournaments/3`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1200)
  const champ = 'E2E Champion ' + stamp
  await page.fill('input[name=championName]', champ)
  await page.locator('main form').getByRole('button', { name: '保存' }).first().click()
  await page.waitForTimeout(3000)
  check(
    'Champion override persists',
    db('select champion_name from tournament where id=3') === champ,
  )

  await page.goto(`${BASE}/tournaments`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  check(
    'Champion appears in the honours list',
    (await page.evaluate(() => document.body.innerText)).includes(champ),
  )

  check('Pages have no runtime errors', errors.length === 0, errors.slice(0, 1).join())
} finally {
  // Bracket generation clears match_map; restore demo fixtures for the public suite.
  execSync(
    'for f in seeds/*.sql; do docker compose exec -T db psql -U postgres -d cs2cup -q -f - < "$f" >/dev/null 2>&1; done',
    {
      shell: '/bin/bash',
      cwd: ROOT,
    },
  )

  db(`delete from photo where caption='E2E upload probe'`)
  db(`update tournament set champion_name=null where id=3`)
  db(`delete from post where slug like 'e2e-%'`)
  db(`delete from tournament where slug like 'e2e-cup-%'`)
  if (originalTagline !== null) {
    db(`update game set tagline=${sqlString(originalTagline)} where slug='cs2'`)
  }

  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
