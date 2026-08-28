import { chromium } from 'playwright'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BASE = (process.env.E2E_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const DB_NAME = process.env.E2E_DB_NAME
if (!DB_NAME) {
  throw new Error(
    'Admin E2E is destructive and refuses the shared cs2cup database. ' +
      'Set E2E_DB_NAME to a dedicated cs2cup_e2e database.',
  )
}
if (!/^cs2cup_e2e(?:_[a-zA-Z0-9_]+)?$/.test(DB_NAME)) {
  throw new Error('E2E_DB_NAME must be cs2cup_e2e or start with cs2cup_e2e_')
}
if (process.env.E2E_DB_OWNED !== '1') {
  throw new Error(
    'E2E_DB_NAME alone does not prove isolation. Set E2E_DB_OWNED=1 only when ' +
      'the named database and its fixtures are disposable and owned by this test run.',
  )
}
const tokenFile = process.env.DEV_TOKEN_FILE ?? '/tmp/dev-token.txt'
const nonAdminTokenFile = process.env.DEV_NON_ADMIN_TOKEN_FILE ?? `${tokenFile}.non-admin`
const legacyPublicPhotoKey = process.env.E2E_LEGACY_PUBLIC_PHOTO_KEY
if (legacyPublicPhotoKey && !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(legacyPublicPhotoKey)) {
  throw new Error('E2E_LEGACY_PUBLIC_PHOTO_KEY is unsafe')
}
const photoLocalRoot = process.env.E2E_PHOTO_LOCAL_ROOT
if (photoLocalRoot && !isAbsolute(photoLocalRoot)) {
  throw new Error('E2E_PHOTO_LOCAL_ROOT must be absolute')
}
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
const connectedDatabase = db('select current_database()')
if (connectedDatabase !== DB_NAME) {
  throw new Error(`psql connected to ${connectedDatabase || '(unknown)'} instead of ${DB_NAME}`)
}

const seedDatabase = () => {
  const seedRoot = join(ROOT, 'seeds')
  const seedFiles = readdirSync(seedRoot)
    .filter(file => file.endsWith('.sql'))
    .sort()

  for (const seedFile of seedFiles) {
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
        '-q',
        '-f',
        '-',
      ],
      {
        cwd: ROOT,
        input: readFileSync(join(seedRoot, seedFile)),
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    )
  }
}

const results = []
const check = (name, pass, detail = '') => {
  results.push(pass)
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const requiredPrivateCacheDirectives = [
  'private',
  'no-cache',
  'no-store',
  'max-age=0',
  'must-revalidate',
]

const privateCacheResult = response => {
  const value = response?.headers()['cache-control'] ?? ''
  const directives = value
    .toLowerCase()
    .split(',')
    .map(directive => directive.trim())
    .filter(Boolean)
  const directiveSet = new Set(directives)
  const forbidden =
    directiveSet.has('public') ||
    directiveSet.has('immutable') ||
    directives.some(directive => directive.startsWith('s-maxage='))
  return {
    pass: requiredPrivateCacheDirectives.every(directive => directiveSet.has(directive)) && !forbidden,
    value: value || '(missing)',
  }
}

const checkPrivateCache = (name, response) => {
  const result = privateCacheResult(response)
  check(name, result.pass, result.value)
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
const publicProbeSlug = `e2e-isolation-public-${stamp}`
const adminProbeSlug = `e2e-isolation-admin-${stamp}`
const publicProbeTitle = `E2E public database probe ${stamp}`
const adminProbeTitle = `E2E admin database probe ${stamp}`
const uploadCaption = `E2E upload probe ${stamp}`
let originalTagline = null
let isolationProbeCreated = false
let isolationVerified = false
let createdTournamentId = null
let uploadedPhotoKey = null
let uploadTournamentId = null
let uploadTournamentStatus = null
let uploadTempDir = null

try {
  const namespaceProbe = await browser.newContext()
  const invalidSessionProbe = await browser.newContext()
  try {
    await invalidSessionProbe.addCookies([
      { name: 'cs2cup_session', value: 'invalid.cache.probe', url: BASE },
    ])

    const anonymousAdmin = await namespaceProbe.request.get(`${BASE}/admin`, {
      maxRedirects: 0,
    })
    check(
      'Anonymous admin response remains a login redirect',
      anonymousAdmin.status() === 307 &&
        new URL(anonymousAdmin.headers().location, BASE).pathname === '/admin/login',
      String(anonymousAdmin.status()),
    )
    checkPrivateCache('Anonymous admin redirect is private and non-storable', anonymousAdmin)

    const invalidAdmin = await invalidSessionProbe.request.get(`${BASE}/admin`, {
      maxRedirects: 0,
    })
    check(
      'Invalid admin session is rejected and cleared',
      invalidAdmin.status() === 307 &&
        (invalidAdmin.headers()['set-cookie'] ?? '').includes('cs2cup_session='),
      String(invalidAdmin.status()),
    )
    checkPrivateCache('Invalid-session redirect is private and non-storable', invalidAdmin)

    const loginPage = await namespaceProbe.request.get(`${BASE}/admin/login`, {
      maxRedirects: 0,
    })
    check('Anonymous login page remains available', loginPage.status() === 200, String(loginPage.status()))
    checkPrivateCache('Login page is private and non-storable', loginPage)

    for (const [path, expectedStatus] of [
      ['/admin/', 308],
      ['/media/cache-boundary-missing/', 308],
      ['/photos/cache-boundary-missing/', 308],
    ]) {
      const response = await namespaceProbe.request.get(`${BASE}${path}`, { maxRedirects: 0 })
      check(
        `${path} keeps its canonical redirect`,
        response.status() === expectedStatus &&
          new URL(response.headers().location, BASE).pathname === path.replace(/\/$/, ''),
        `${response.status()} → ${response.headers().location ?? '(missing)'}`,
      )
    }

    for (const path of ['/media/cache-boundary-missing', '/photos/cache-boundary-missing']) {
      const response = await namespaceProbe.request.get(`${BASE}${path}`, { maxRedirects: 0 })
      check(`${path} remains unavailable`, response.status() === 404, String(response.status()))
      checkPrivateCache(`${path} 404 is private and non-storable`, response)
    }
  } finally {
    await namespaceProbe.close()
    await invalidSessionProbe.close()
  }

  if (legacyPublicPhotoKey) {
    const guardedMedia = await ctx.request.get(`${BASE}/media/${legacyPublicPhotoKey}`)
    const legacyStaticMedia = await ctx.request.get(`${BASE}/photos/${legacyPublicPhotoKey}`)
    const legacyOptimizer = await ctx.request.get(
      `${BASE}/_next/image?url=${encodeURIComponent(`/photos/${legacyPublicPhotoKey}`)}` +
        '&w=640&q=75',
    )
    check(
      'Published media is available only through the guarded route',
      guardedMedia.status() === 200 && legacyStaticMedia.status() === 404,
      `/media=${guardedMedia.status()} /photos=${legacyStaticMedia.status()}`,
    )
    check(
      'The image optimizer cannot revive the legacy public photo path',
      legacyOptimizer.status() >= 400 && legacyOptimizer.status() < 500,
      String(legacyOptimizer.status()),
    )
    checkPrivateCache('Published guarded media is private and non-storable', guardedMedia)
    checkPrivateCache('Legacy photo rejection is private and non-storable', legacyStaticMedia)
  }

  db(`
    insert into post (slug, title, summary, body, published_at)
    values
      (
        ${sqlString(publicProbeSlug)},
        ${sqlString(publicProbeTitle)},
        'Public endpoint isolation probe',
        'Public endpoint isolation probe',
        now() - interval '1 minute'
      ),
      (
        ${sqlString(adminProbeSlug)},
        ${sqlString(adminProbeTitle)},
        'Admin endpoint isolation probe',
        'Admin endpoint isolation probe',
        now() + interval '1 day'
      )
  `)
  isolationProbeCreated = true

  const publicProbeContext = await browser.newContext()
  try {
    const publicProbeResponse = await publicProbeContext.request.get(
      `${BASE}/news/${publicProbeSlug}?e2e-isolation=${stamp}`,
    )
    const publicProbeBody = await publicProbeResponse.text()
    if (publicProbeResponse.status() !== 200 || !publicProbeBody.includes(publicProbeTitle)) {
      throw new Error(
        `Public application endpoint is not reading ${DB_NAME} ` +
          `(status ${publicProbeResponse.status()})`,
      )
    }

    const privateProbeResponse = await publicProbeContext.request.get(
      `${BASE}/news/${adminProbeSlug}?e2e-isolation=${stamp}`,
    )
    const privateProbeBody = await privateProbeResponse.text()
    if (privateProbeResponse.status() >= 500 || privateProbeBody.includes(adminProbeTitle)) {
      throw new Error('Public application endpoint exposes the admin-only isolation probe')
    }
    check('Public application endpoint uses the isolated database', true, DB_NAME)
  } finally {
    await publicProbeContext.close()
  }

  const adminProbeResponse = await page.goto(`${BASE}/admin/posts?e2e-isolation=${stamp}`, {
    waitUntil: 'domcontentloaded',
  })
  let adminProbeVisible = false
  try {
    await page.getByText(adminProbeTitle, { exact: true }).waitFor({ timeout: 10_000 })
    adminProbeVisible = true
  } catch {
    // The diagnostic below distinguishes an auth redirect from a data mismatch.
  }
  if (!adminProbeVisible) {
    const adminProbeBody = await page.locator('body').innerText()
    throw new Error(
      `Admin application endpoint is not reading ${DB_NAME}; ` +
        `status=${adminProbeResponse?.status() ?? 'none'} url=${page.url()} ` +
        `body=${JSON.stringify(adminProbeBody.slice(0, 240))}`,
    )
  }
  check('Admin application endpoint uses the isolated database', true, DB_NAME)
  checkPrivateCache('Authenticated admin document is private and non-storable', adminProbeResponse)
  isolationVerified = true

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
  const privateCacheFailures = []

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
    if (!privateCacheResult(response).pass) {
      privateCacheFailures.push(`${route}:${privateCacheResult(response).value}`)
    }
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
  check(
    'Every rejected console document is private and non-storable',
    privateCacheFailures.length === 0,
    privateCacheFailures.join(', '),
  )

  const crossIdentityResponse = await nonAdmin.request.get(
    `${BASE}/admin/posts?e2e-isolation=${stamp}`,
    { maxRedirects: 0 },
  )
  const crossIdentityBody = await crossIdentityResponse.text()
  check(
    'An authenticated admin document is never reused for a non-admin',
    redirectsToLogin(crossIdentityResponse, crossIdentityBody) &&
      !crossIdentityBody.includes(adminProbeTitle),
    String(crossIdentityResponse.status()),
  )
  checkPrivateCache(
    'Cross-identity admin response is private and non-storable',
    crossIdentityResponse,
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
  checkPrivateCache('Rejected RSC response is private and non-storable', rscResponse)
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
  createdTournamentId = Number(
    db(`select id from tournament where slug=${sqlString(`e2e-cup-${stamp}`)}`),
  )
  if (!Number.isSafeInteger(createdTournamentId) || createdTournamentId <= 0) {
    throw new Error('Admin-created tournament was not written to the isolated database')
  }

  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  const res = await anonPage.request.get(`${BASE}/admin/posts`, {
    maxRedirects: 0,
  })
  check('Unauthenticated admin access is rejected', res.status() === 307, String(res.status()))
  checkPrivateCache('Unauthenticated admin rejection is private and non-storable', res)
  await anon.close()

  // Upload media.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGQAAABGCAYAAAA2Vh8vAAAAJUlEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAA4M0AKvgAAY0jZuQAAAAASUVORK5CYII=',
    'base64',
  )
  uploadTempDir = mkdtempSync(join(tmpdir(), 'cs2cup-admin-e2e-'))
  const uploadPath = join(uploadTempDir, 'probe.png')
  writeFileSync(uploadPath, png)

  await page.goto(`${BASE}/admin/photos`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const photosBefore = Number(db('select count(*) from photo'))
  await page.selectOption('select[name=tournamentId]', String(createdTournamentId))
  await page.setInputFiles('input[type=file]', uploadPath)
  await page.fill('#up-caption', uploadCaption)
  await page.locator('main form').getByRole('button', { name: '上传' }).click()
  await page.waitForTimeout(3000)
  const photosAfter = Number(db('select count(*) from photo'))
  check('Admin uploads media', photosAfter === photosBefore + 1, `${photosBefore} → ${photosAfter}`)

  uploadedPhotoKey = db(`select storage_key from photo where caption=${sqlString(uploadCaption)}`)
  uploadTournamentId = Number(
    db(`select tournament_id from photo where caption=${sqlString(uploadCaption)}`),
  )
  uploadTournamentStatus = db(
    `select status from tournament where id=${uploadTournamentId}`,
  )
  if (
    !uploadedPhotoKey ||
    uploadTournamentId !== createdTournamentId ||
    uploadTournamentStatus !== 'draft'
  ) {
    throw new Error('Uploaded media is not attached to the isolated E2E tournament')
  }

  // Exercise the exact public URL across a publish/unpublish transition. A
  // positive or negative authorization lookup must not survive a state change.
  // The shared Next image optimizer is intentionally unavailable for guarded
  // media, so it cannot retain a previously public object after withdrawal.
  const publicMediaContext = await browser.newContext()
  try {
    const mediaUrl = `${BASE}/media/${uploadedPhotoKey}`
    const optimizedMediaUrl =
      `${BASE}/_next/image?url=${encodeURIComponent(`/media/${uploadedPhotoKey}`)}` +
      '&w=640&q=75'

    const initiallyHidden = await publicMediaContext.request.get(mediaUrl)
    const draftAdminMedia = await ctx.request.get(mediaUrl)
    check(
      'Draft media is hidden before publication',
      initiallyHidden.status() === 404,
      String(initiallyHidden.status()),
    )
    check(
      'Draft media remains available to an administrator',
      draftAdminMedia.status() === 200,
      String(draftAdminMedia.status()),
    )
    checkPrivateCache('Anonymous draft-media rejection is private and non-storable', initiallyHidden)
    checkPrivateCache('Administrator draft media is private and non-storable', draftAdminMedia)

    const optimizerDenied = await publicMediaContext.request.get(optimizedMediaUrl)
    check(
      'Guarded media is excluded from the shared image optimizer',
      optimizerDenied.status() >= 400 && optimizerDenied.status() < 500,
      String(optimizerDenied.status()),
    )

    db(`update tournament set status='registration' where id=${uploadTournamentId}`)
    const warmedPublicMedia = await publicMediaContext.request.get(mediaUrl)
    check(
      'Published media can be fetched and warms the authorization path',
      warmedPublicMedia.status() === 200,
      String(warmedPublicMedia.status()),
    )
    checkPrivateCache('Published media response is private and non-storable', warmedPublicMedia)

    db(`update tournament set status='draft' where id=${uploadTournamentId}`)
    const hiddenAgain = await publicMediaContext.request.get(mediaUrl)
    const optimizerStillDenied = await publicMediaContext.request.get(optimizedMediaUrl)
    check(
      'A warmed media URL returns 404 after its tournament returns to draft',
      hiddenAgain.status() === 404,
      String(hiddenAgain.status()),
    )
    checkPrivateCache('Withdrawn media rejection is private and non-storable', hiddenAgain)
    check(
      'The image optimizer cannot bypass media withdrawal',
      optimizerStillDenied.status() >= 400 && optimizerStillDenied.status() < 500,
      String(optimizerStillDenied.status()),
    )
  } finally {
    db(
      `update tournament set status=${sqlString(uploadTournamentStatus)} ` +
        `where id=${uploadTournamentId}`,
    )
    await publicMediaContext.close()
  }
  const dims = db(
    `select width||'x'||height from photo where caption=${sqlString(uploadCaption)}`,
  )
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
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const scheduled = Number(
      db(`select count(*) from match m where ${nonByeFilter} and m.scheduled_at is not null`),
    )
    if (scheduled === nonByeMatches) break
    await page.waitForTimeout(250)
  }

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
  if (isolationVerified) {
    if (uploadedPhotoKey) {
      let mediaCleanupSucceeded = false
      const objectPath = photoLocalRoot
        ? resolve(photoLocalRoot, uploadedPhotoKey)
        : null
      if (objectPath && !objectPath.startsWith(`${resolve(photoLocalRoot)}${sep}`)) {
        throw new Error('Uploaded media key escapes E2E_PHOTO_LOCAL_ROOT')
      }
      try {
        await page.goto(`${BASE}/admin/photos?e2e-cleanup=${stamp}`, {
          waitUntil: 'domcontentloaded',
        })
        await page.waitForTimeout(1_000)
        const photoRow = page
          .getByText(uploadCaption, { exact: true })
          .locator('xpath=ancestor::div[contains(@class,"listRow")][1]')
        page.once('dialog', dialog => dialog.accept())
        await photoRow.getByRole('button', { name: '删除', exact: true }).click()

        for (let attempt = 0; attempt < 20; attempt += 1) {
          const recordRemoved = Number(
            db(`select count(*) from photo where storage_key=${sqlString(uploadedPhotoKey)}`),
          ) === 0
          const objectRemoved = !objectPath || !existsSync(objectPath)
          if (recordRemoved && objectRemoved) {
            mediaCleanupSucceeded = true
            break
          }
          await page.waitForTimeout(250)
        }
      } catch (error) {
        console.warn(`Admin media cleanup failed: ${error.message}`)
      }

      check(
        'Admin cleanup removes the uploaded media record and object',
        mediaCleanupSucceeded,
        `${uploadedPhotoKey}${objectPath ? ` @ ${objectPath}` : ''}`,
      )
      if (!mediaCleanupSucceeded) {
        db(`delete from photo where storage_key=${sqlString(uploadedPhotoKey)}`)
      }
    }

    // Bracket and schedule tests replace demo matches. This database passed
    // the application endpoint probes and is explicitly owned by the suite.
    db(`
      delete from match
      where tournament_id = (select id from tournament where slug = '2026-nlc')
    `)
    seedDatabase()

    db(`update tournament set champion_name=null where id=3`)
    db(
      `delete from post where slug in (` +
        `${sqlString(`e2e-${stamp}`)}, ` +
        `${sqlString(publicProbeSlug)}, ${sqlString(adminProbeSlug)})`,
    )
    db(`delete from tournament where slug=${sqlString(`e2e-cup-${stamp}`)}`)
    if (originalTagline !== null) {
      db(`update game set tagline=${sqlString(originalTagline)} where slug='cs2'`)
    }
  }

  if (isolationProbeCreated) {
    db(
      `delete from post where slug in (` +
        `${sqlString(publicProbeSlug)}, ${sqlString(adminProbeSlug)})`,
    )
  }
  if (uploadTempDir) {
    rmSync(uploadTempDir, { recursive: true, force: true })
  }

  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
if (failed) process.exit(1)
