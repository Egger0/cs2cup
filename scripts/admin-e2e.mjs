import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const DB_NAME = process.env.E2E_DB_NAME ?? 'cs2cup'
if (!/^[a-zA-Z0-9_]+$/.test(DB_NAME)) {
  throw new Error('E2E_DB_NAME must contain only letters, digits and underscores')
}
const tokenFile = process.env.DEV_TOKEN_FILE ?? '/tmp/dev-token.txt'
const nonAdminTokenFile = process.env.DEV_NON_ADMIN_TOKEN_FILE ?? `${tokenFile}.non-admin`
const token = readFileSync(tokenFile, 'utf8').trim()
const nonAdminToken = readFileSync(nonAdminTokenFile, 'utf8').trim()
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
      DB_NAME,
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
  const tournamentId = Number(db('select id from tournament order by id limit 1')) || 1
  const matchId = Number(db('select id from match order by id limit 1')) || 1
  const sensitiveContact = db(
    "select contact from team where contact is not null and contact <> '' order by id limit 1",
  )
  if (!sensitiveContact) throw new Error('Admin authorization test requires a team contact fixture')

  const nonAdmin = await browser.newContext()
  await nonAdmin.addCookies([{ name: 'cs2cup_session', value: nonAdminToken, url: BASE }])
  const protectedRoutes = [
    '/admin',
    '/admin/games',
    '/admin/members',
    '/admin/photos',
    '/admin/posts',
    '/admin/settings',
    '/admin/tournaments',
    `/admin/tournaments/${tournamentId}`,
    `/admin/tournaments/${tournamentId}/matches/${matchId}`,
  ]
  const routeFailures = []
  const piiLeaks = []

  const redirectsToLogin = (response, body) => {
    const location = response.headers().location ?? response.headers()['x-nextjs-redirect']
    if (location) return new URL(location, BASE).pathname === '/admin/login'
    return body.includes('NEXT_REDIRECT') && body.includes('/admin/login')
  }

  for (const route of protectedRoutes) {
    const response = await nonAdmin.request.get(`${BASE}${route}`, { maxRedirects: 0 })
    const body = await response.text()
    if (!redirectsToLogin(response, body)) routeFailures.push(`${route}:${response.status()}`)
    if (body.includes(sensitiveContact)) piiLeaks.push(route)
  }

  check(
    'Valid non-admin sessions are rejected by every console page',
    routeFailures.length === 0,
    routeFailures.join(', '),
  )
  check(
    'Rejected console documents contain no registration contact data',
    piiLeaks.length === 0,
    piiLeaks.join(', '),
  )

  const routerState = [
    '',
    {
      children: [
        'admin',
        {
          children: [
            '(console)',
            {
              children: [
                'posts',
                { children: ['__PAGE__', {}, null, null, 4096] },
                null,
                null,
                4096,
              ],
            },
            null,
            null,
            4096,
          ],
        },
        null,
        null,
        4096,
      ],
    },
    null,
    null,
    4116,
  ]
  const rscHeaders = {
    RSC: '1',
    'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(routerState)),
    'Next-Url': '/admin/posts',
  }
  let rscResponse = await nonAdmin.request.get(`${BASE}/admin?_rsc=authorization-boundary`, {
    headers: rscHeaders,
    maxRedirects: 0,
  })
  const canonicalRscLocation = rscResponse.headers().location
  if (rscResponse.status() === 307 && canonicalRscLocation) {
    const canonicalRscUrl = new URL(canonicalRscLocation, BASE)
    if (canonicalRscUrl.pathname === '/admin' && canonicalRscUrl.searchParams.has('_rsc')) {
      rscResponse = await nonAdmin.request.get(canonicalRscUrl.toString(), {
        headers: rscHeaders,
        maxRedirects: 0,
      })
    }
  }
  const rscBody = await rscResponse.text()
  check(
    'Valid non-admin RSC requests are redirected before rendering',
    redirectsToLogin(rscResponse, rscBody),
    String(rscResponse.status()),
  )
  check(
    'Rejected RSC streams contain no registration contact data',
    !rscBody.includes(sensitiveContact),
  )
  await nonAdmin.close()

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
  check('Admin can preview draft media', served.status() === 200, `${served.status()} ${key}`)

  const publicMediaContext = await browser.newContext()
  const hiddenDraftMedia = await publicMediaContext.request.get(`${BASE}/media/${key}`)
  check(
    'Draft media remains hidden from public requests',
    hiddenDraftMedia.status() === 404,
    String(hiddenDraftMedia.status()),
  )
  await publicMediaContext.close()
  const dims = db(`select width||'x'||height from photo where caption='E2E upload probe'`)
  check('Uploaded dimensions are detected', dims === '100x70', dims)

  // Generate the bracket.
  const scheduleTournamentId = Number(
    db(`select id from tournament where slug = '2026-nlc'`),
  )
  if (!Number.isSafeInteger(scheduleTournamentId) || scheduleTournamentId <= 0) {
    throw new Error('Canonical schedule tournament is missing')
  }
  await page.goto(`${BASE}/admin/tournaments/${scheduleTournamentId}`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForTimeout(1200)
  const beforeMatches = Number(
    db(`select count(*) from match where tournament_id=${scheduleTournamentId}`),
  )
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: /生成对阵表|重新抽签/ }).click()
  await page.waitForTimeout(6000)
  const afterMatches = Number(
    db(`select count(*) from match where tournament_id=${scheduleTournamentId}`),
  )
  check('Admin generates a bracket', afterMatches === 15, `${beforeMatches} → ${afterMatches}`)
  const linked = Number(
    db(
      `select count(*) from match where tournament_id=${scheduleTournamentId} and source_match_a_id is not null`,
    ),
  )
  check('Bracket progression is linked', linked === 7, String(linked))
  const seeded = Number(
    db(
      `select count(*) from match where tournament_id=${scheduleTournamentId} and round=0 and team_a_id is not null`,
    ),
  )
  check('Opening round follows seed placement', seeded === 8, String(seeded))

  // Preview and publish the full schedule.
  const nonByeFilter = `
    m.tournament_id = ${scheduleTournamentId}
    and not (
      m.round = 0
      and m.source_match_a_id is null
      and m.source_match_b_id is null
      and m.winner_team_id is not null
      and m.score_a is null
      and m.score_b is null
      and ((m.team_a_id is null) <> (m.team_b_id is null))
    )
  `
  const scheduleSnapshotSql = `
    select coalesce(
      string_agg(
        m.id::text || '=' || coalesce(m.scheduled_at::text, 'null'),
        ',' order by m.id
      ),
      ''
    )
    from match m
    where ${nonByeFilter}
  `
  const nonByeMatches = Number(db(`select count(*) from match m where ${nonByeFilter}`))
  const beforeSchedulePreview = db(scheduleSnapshotSql)
  const firstBeijingTime = '2099-05-06T19:30'

  await page.fill('#sc-start', firstBeijingTime)
  await page.fill('#sc-round', '2')
  await page.fill('#sc-match', '90')
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByText('预览已生成，确认无误后再发布').waitFor()

  const firstMatchTime = page.getByLabel(/第 1 场开赛时间/).first()
  check(
    'Schedule preview starts at the requested Beijing local time',
    (await firstMatchTime.inputValue()) === firstBeijingTime,
    await firstMatchTime.inputValue(),
  )
  const afterSchedulePreview = db(scheduleSnapshotSql)
  check(
    'Generating a schedule preview performs zero database writes',
    afterSchedulePreview === beforeSchedulePreview,
  )

  const scheduleUrl = page.url()
  const navigationDialogPromise = page.waitForEvent('dialog')
  const navigationPromise = page.getByRole('link', { name: '项目', exact: true }).click()
  const navigationDialog = await navigationDialogPromise
  const navigationWarning = navigationDialog.message()
  await navigationDialog.dismiss()
  await navigationPromise
  check(
    'Unsaved schedule changes block internal navigation',
    page.url() === scheduleUrl && navigationWarning.includes('未发布'),
  )

  await page.setViewportSize({ width: 390, height: 844 })
  const plannerActions = page
    .locator('form:has(#sc-start)')
    .getByRole('button')
  const plannerActionBoxes = await plannerActions.evaluateAll(buttons =>
    buttons.map(button => {
      const rect = button.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  )
  check(
    'Schedule planner actions remain usable on mobile',
    plannerActionBoxes.length === 3 &&
      plannerActionBoxes.every(box => box.width >= 120 && box.height <= 60),
    JSON.stringify(plannerActionBoxes),
  )
  await page.setViewportSize({ width: 1440, height: 1000 })

  await page.getByRole('button', { name: '发布赛程' }).click()
  await page
    .getByText(`已发布 ${nonByeMatches} 场，${nonByeMatches} 场已有时间`)
    .waitFor({ timeout: 10_000 })

  const publishedSchedule = db(`
    select
      count(*) filter (where m.scheduled_at is not null)::text
      || ':' || count(*)::text
      || ':' || count(distinct m.xmin::text)::text
    from match m
    where ${nonByeFilter}
  `)
  check(
    'Publishing writes every non-bye match atomically',
    publishedSchedule === `${nonByeMatches}:${nonByeMatches}:1`,
    publishedSchedule,
  )

  const firstUtcTime = db(`
    select to_char(
      m.scheduled_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    )
    from match m
    where ${nonByeFilter}
    order by m.round, m.slot
    limit 1
  `)
  check(
    'Beijing datetime-local persists as the correct UTC instant',
    firstUtcTime === '2099-05-06T11:30:00Z',
    firstUtcTime,
  )

  const chronologicalViolations = Number(db(`
    select count(*)
    from match child
    join match source
      on source.id = child.source_match_a_id
      or source.id = child.source_match_b_id
    where child.tournament_id = ${scheduleTournamentId}
      and source.tournament_id = ${scheduleTournamentId}
      and child.scheduled_at is not null
      and source.scheduled_at is not null
      and child.scheduled_at <= source.scheduled_at
  `))
  check(
    'Parent matches are scheduled after every scheduled source',
    chronologicalViolations === 0,
    String(chronologicalViolations),
  )

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
  // Bracket and schedule tests replace demo matches; rebuild canonical public fixtures.
  db(`
    delete from match
    where tournament_id = (select id from tournament where slug = '2026-nlc')
  `)
  execSync(
    `for f in seeds/*.sql; do docker compose exec -T db psql -U postgres -d ${DB_NAME} -q -f - < "$f" >/dev/null 2>&1; done`,
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
