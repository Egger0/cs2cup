import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { unstable_readConfig } from 'wrangler'
import {
  bytesToHex,
  digestAdminSessionToken,
} from '../lib/admin-auth-crypto.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerConfigPath = join(root, 'wrangler.jsonc')
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const workerPath = join(root, '.open-next', 'worker.js')
const assetsPath = join(root, '.open-next', 'assets')
const databaseBinding = 'CS2CUP_DATABASE'
const mediaBinding = 'CS2CUP_MEDIA'
const hyperdriveEnvironmentVariable =
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${databaseBinding}`
const databaseUrl = process.env[hyperdriveEnvironmentVariable]
const expectedDatabase = process.env.CLOUDFLARE_WORKER_SMOKE_EXPECTED_DATABASE
const mutationAcknowledged =
  process.env.CLOUDFLARE_WORKER_SMOKE_ALLOW_DATABASE_MUTATION === '1'
const adminUsername = process.env.CLOUDFLARE_WORKER_SMOKE_ADMIN_USERNAME
const adminPassword = process.env.CLOUDFLARE_WORKER_SMOKE_ADMIN_PASSWORD
const adminPepper = process.env.ADMIN_AUTH_PEPPER
const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL
const activeWorkers = new Set()
let fixtureCleanup = null
let fixtureCreationPromise = null
let temporaryRoot = null
let cleanupPromise = null
let shutdownExitCode = null

function fail(message) {
  throw new Error(message)
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

function redacted(log) {
  return databaseUrl ? log.replaceAll(databaseUrl, '<redacted database URL>') : log
}

function workerEnvironment(bindingName) {
  const environment = { ...process.env }
  delete environment.DATABASE_URL
  delete environment.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_CS2CUP_DATABASE
  delete environment.CLOUDFLARE_API_TOKEN
  delete environment.CLOUDFLARE_API_KEY
  delete environment.CF_API_TOKEN
  delete environment.CF_API_KEY
  delete environment.CLOUDFLARE_ACCOUNT_ID
  delete environment.CF_ACCOUNT_ID
  delete environment.ADMIN_AUTH_PEPPER
  delete environment.REGISTRATION_FINGERPRINT_SECRET
  for (const name of Object.keys(environment)) {
    if (name.startsWith('CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_')) {
      delete environment[name]
    }
  }
  environment[`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_${bindingName}`] = databaseUrl
  // Wrangler gates even an explicit --env-file behind this switch. The test
  // always supplies its own mode-0600 file, so no project .env file is read.
  environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'true'
  environment.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
  environment.WRANGLER_SEND_METRICS = 'false'
  environment.X_LOCAL_OBSERVABILITY = 'false'
  environment.NO_COLOR = '1'
  return environment
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object')
  await new Promise((resolveClose, rejectClose) => {
    server.close(error => error ? rejectClose(error) : resolveClose())
  })
  return address.port
}

function capture(child) {
  let log = ''
  const append = chunk => {
    log = `${log}${chunk}`.slice(-40_000)
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  return () => redacted(log)
}

async function stopWorker(worker) {
  if (!worker || worker.child.exitCode !== null || worker.child.signalCode !== null) return
  try {
    if (process.platform === 'win32') worker.child.kill('SIGTERM')
    else process.kill(-worker.child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  await Promise.race([worker.closed, delay(5_000)])
  if (worker.child.exitCode === null && worker.child.signalCode === null) {
    if (process.platform === 'win32') worker.child.kill('SIGKILL')
    else process.kill(-worker.child.pid, 'SIGKILL')
    await worker.closed
  }
}

async function stopAllWorkers() {
  await Promise.all([...activeWorkers].map(stopWorker))
}

async function cleanupResources() {
  cleanupPromise ??= (async () => {
    const errors = []
    try {
      await stopAllWorkers()
    } catch (error) {
      errors.push(error)
    }
    const results = await Promise.allSettled([
      temporaryRoot
        ? rm(temporaryRoot, { recursive: true, force: true })
        : Promise.resolve(),
      fixtureCleanup ? fixtureCleanup() : Promise.resolve(),
    ])
    for (const result of results) {
      if (result.status === 'rejected') errors.push(result.reason)
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Worker smoke cleanup failed')
  })()
  await cleanupPromise
}

async function fetchWithTimeout(url, init = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(5_000) })
}

async function startWorker({
  configPath,
  envFilePath,
  persistencePath,
  bindingName,
  variables = {},
}) {
  const port = await availablePort()
  const arguments_ = [
    wranglerBin,
    'dev',
    '--config', configPath,
    '--env-file', envFilePath,
    '--local',
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--persist-to', persistencePath,
    '--show-interactive-dev-session', 'false',
    '--log-level', 'error',
  ]
  for (const [name, value] of Object.entries(variables)) {
    arguments_.push('--var', `${name}:${value}`)
  }
  const child = spawn(process.execPath, arguments_, {
    cwd: root,
    detached: process.platform !== 'win32',
    env: workerEnvironment(bindingName),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const readLog = capture(child)
  let childError = null
  child.once('error', error => {
    childError = error
  })
  const closed = new Promise(resolveClosed => {
    child.once('close', (code, signal) => resolveClosed({ code, signal }))
  })
  const worker = { child, closed, readLog, baseUrl: `http://127.0.0.1:${port}` }
  activeWorkers.add(worker)
  void closed.then(() => activeWorkers.delete(worker))

  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (childError) {
      fail(`Could not start Wrangler: ${childError.message}`)
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(`Wrangler exited before becoming ready:\n${readLog()}`)
    }
    try {
      const response = await fetchWithTimeout(`${worker.baseUrl}/robots.txt`)
      await response.arrayBuffer()
      if (response.status === 200) return worker
    } catch {
      // Wrangler has not opened the local port yet.
    }
    await delay(100)
  }
  await stopWorker(worker)
  fail(`Timed out waiting for Wrangler:\n${readLog()}`)
}

async function runWranglerR2Put({ bucketName, key, persistencePath, body }) {
  const child = spawn(process.execPath, [
    wranglerBin,
    'r2', 'object', 'put', `${bucketName}/${key}`,
    '--config', wranglerConfigPath,
    '--local',
    '--persist-to', persistencePath,
    '--pipe',
    '--content-type', 'application/octet-stream',
    '--force',
  ], {
    cwd: root,
    env: workerEnvironment(databaseBinding),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const readLog = capture(child)
  child.stdin.end(body)
  const result = await new Promise((resolveResult, rejectResult) => {
    child.once('error', rejectResult)
    child.once('close', (code, signal) => resolveResult({ code, signal }))
  })
  if (result.code !== 0) {
    fail(`Wrangler could not populate local R2:\n${readLog()}`)
  }
}

async function createDatabaseFixture() {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 })
  try {
    const contextRows = await sql`
      select
        current_database() as database_name,
        current_user as database_user,
        session_user as database_session_user,
        database_role.rolcanlogin as role_login,
        database_role.rolinherit as role_inherit,
        database_role.rolsuper as role_superuser,
        database_role.rolcreatedb as role_create_database,
        database_role.rolcreaterole as role_create_role,
        database_role.rolreplication as role_replication,
        database_role.rolbypassrls as role_bypass_rls,
        coalesce((
          select pg_catalog.string_agg(
            inherited_role.rolname,
            ',' order by inherited_role.rolname
          )
          from pg_catalog.pg_roles inherited_role
          where inherited_role.rolname <> session_user
            and pg_catalog.pg_has_role(
              session_user,
              inherited_role.oid,
              'member'
            )
        ), '') as role_memberships,
        pg_catalog.pg_has_role(current_user, 'club_admin', 'member')
          as inherits_club_admin,
        pg_catalog.has_schema_privilege(
          current_user,
          'app_private',
          'usage'
        ) as private_schema_usage,
        coalesce((
          select pg_catalog.bool_or(pg_catalog.has_function_privilege(
            current_user, procedure.oid, 'execute'
          ))
          from pg_catalog.pg_proc procedure
          join pg_catalog.pg_namespace namespace
            on namespace.oid = procedure.pronamespace
          where namespace.nspname = 'app_private'
            and procedure.proname = 'set_local_admin_credential'
        ), false) as credential_mutation,
        setting.club_name,
        published_tournament.id as tournament_id
      from public.site_setting setting
      cross join pg_catalog.pg_roles database_role
      cross join lateral (
        select tournament.id
        from public.tournament tournament
        where tournament.status <> 'draft'
        order by tournament.id
        limit 1
      ) published_tournament
      where database_role.rolname = current_user
      order by setting.id
      limit 1
    `
    const context = contextRows[0]
    if (context?.database_name !== expectedDatabase) {
      fail(
        `Refusing fixture write: expected database ${expectedDatabase}, connected to ${context?.database_name ?? 'unknown'}`,
      )
    }
    if (
      !context.database_user
      || context.database_user === 'postgres'
      || context.database_session_user !== context.database_user
      || context.role_login !== true
      || context.role_inherit !== true
      || context.role_superuser !== false
      || context.role_create_database !== false
      || context.role_create_role !== false
      || context.role_replication !== false
      || context.role_bypass_rls !== false
      || context.role_memberships !== 'club_admin'
      || context.inherits_club_admin !== true
      || context.private_schema_usage !== false
      || context.credential_mutation !== false
    ) {
      fail('Worker smoke requires a least-privilege login that inherits club_admin')
    }
    if (!context.club_name || !context.tournament_id) {
      fail('Worker smoke requires a seeded site setting and one published tournament')
    }

    const storageKey = `worker-smoke/${randomUUID()}.jpg`
    const insertedRows = await sql`
      insert into public.photo (
        tournament_id,
        storage_key,
        width,
        height,
        caption,
        sort_order
      ) values (
        ${context.tournament_id},
        ${storageKey},
        1,
        1,
        'local Worker runtime smoke fixture',
        2147483647
      )
      returning id
    `
    const photoId = insertedRows[0]?.id
    if (!photoId) fail('Worker smoke could not create its photo fixture')

    return {
      clubName: context.club_name,
      storageKey,
      async cleanup() {
        try {
          const deletedRows = await sql`
            delete from public.photo
            where id = ${photoId}
              and storage_key = ${storageKey}
            returning id
          `
          assert.equal(deletedRows.length, 1, 'Worker smoke photo fixture was not cleaned up')
        } finally {
          await sql.end({ timeout: 5 })
        }
      },
    }
  } catch (error) {
    await sql.end({ timeout: 5 })
    throw error
  }
}

function encodedMediaPath(storageKey) {
  return `/media/${storageKey.split('/').map(encodeURIComponent).join('/')}`
}

async function expectUnavailable(worker, storageKey, label) {
  const response = await fetchWithTimeout(`${worker.baseUrl}${encodedMediaPath(storageKey)}`)
  const body = await response.text()
  assert.equal(response.headers.get('x-opennext'), '1', `${label} bypassed OpenNext`)
  assert.equal(response.status, 503, `${label} did not fail closed`)
  assert.equal(body, 'service unavailable', `${label} exposed an unexpected response`)
}

async function exerciseAdministratorLogin(worker) {
  if (!adminUsername || !adminPassword || !adminPepper || !siteOrigin) return

  const loginPage = await fetchWithTimeout(`${worker.baseUrl}/admin/login`)
  assert.equal(loginPage.status, 200, 'Worker administrator login page failed')
  assert.equal(loginPage.headers.get('x-opennext'), '1', 'Login page bypassed OpenNext')

  const response = await fetchWithTimeout(`${worker.baseUrl}/admin/session`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'CF-Connecting-IP': '127.0.0.1',
      Origin: new URL(siteOrigin).origin,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: new URLSearchParams({
      username: adminUsername,
      password: adminPassword,
    }),
  })
  const responseBody = await response.text()
  assert.equal(
    response.status,
    303,
    `Worker administrator login was not accepted (${responseBody.slice(0, 200)})`,
  )
  assert.equal(
    new URL(response.headers.get('location'), worker.baseUrl).pathname,
    '/admin',
    'Worker administrator login redirected unexpectedly',
  )
  const setCookie = response.headers.get('set-cookie') ?? ''
  assert.match(setCookie, /^cs2cup_admin=[A-Za-z0-9_-]{43};/)
  assert.match(setCookie, /; HttpOnly(?:;|$)/i)
  assert.match(setCookie, /; SameSite=Strict(?:;|$)/i)
  assert.match(setCookie, /; Path=\/(?:;|$)/i)
  const cookie = setCookie.split(';', 1)[0]
  const token = cookie.slice('cs2cup_admin='.length)

  try {
    const admin = await fetchWithTimeout(`${worker.baseUrl}/admin`, {
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        'CF-Connecting-IP': '127.0.0.1',
      },
    })
    const adminBody = await admin.text()
    assert.equal(admin.status, 200, 'Worker administrator session was not accepted')
    assert.equal(admin.headers.get('x-opennext'), '1', 'Admin request bypassed OpenNext')
    assert(adminBody.includes(adminUsername), 'Worker admin page omitted the authenticated username')
  } finally {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 })
    try {
      await sql`
        select public.end_local_admin_session(
          pg_catalog.decode(${bytesToHex(await digestAdminSessionToken(token))}, 'hex'),
          ${randomUUID()}::uuid
        )
      `
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
}

function generatedConfig(config, { name, databaseBindingName, mediaBindingName }) {
  return {
    name: `cs2cup-worker-smoke-${name}`,
    main: workerPath,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    assets: { directory: assetsPath, binding: 'ASSETS' },
    vars: { PHOTO_UPLOAD_DRIVER: 'r2' },
    hyperdrive: [{ binding: databaseBindingName, id: 'local-worker-smoke' }],
    r2_buckets: [{ binding: mediaBindingName, bucket_name: 'local-worker-smoke-media' }],
  }
}

async function main() {
  if (!databaseUrl) {
    fail(`Set ${hyperdriveEnvironmentVariable} to the least-privilege validation login`)
  }
  if (!expectedDatabase) {
    fail('Set CLOUDFLARE_WORKER_SMOKE_EXPECTED_DATABASE to the validation database name')
  }
  if (!mutationAcknowledged) {
    fail('Set CLOUDFLARE_WORKER_SMOKE_ALLOW_DATABASE_MUTATION=1 to permit the temporary photo fixture')
  }
  const authenticationInputs = [adminUsername, adminPassword, adminPepper, siteOrigin]
  const configuredAuthenticationInputs = authenticationInputs.filter(Boolean).length
  if (configuredAuthenticationInputs !== 0 && configuredAuthenticationInputs !== 4) {
    fail(
      'Worker administrator smoke requires username, password, ADMIN_AUTH_PEPPER, and NEXT_PUBLIC_SITE_URL together',
    )
  }
  if (siteOrigin) {
    let parsedSiteOrigin
    try {
      parsedSiteOrigin = new URL(siteOrigin)
    } catch {
      fail('NEXT_PUBLIC_SITE_URL must be an exact HTTP(S) origin')
    }
    if (
      !['http:', 'https:'].includes(parsedSiteOrigin.protocol)
      || parsedSiteOrigin.origin !== siteOrigin
      || parsedSiteOrigin.pathname !== '/'
      || parsedSiteOrigin.search
      || parsedSiteOrigin.hash
    ) {
      fail('NEXT_PUBLIC_SITE_URL must be an exact HTTP(S) origin')
    }
  }
  const parsedUrl = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    fail('Worker smoke requires a PostgreSQL connection URL')
  }
  await Promise.all([access(workerPath), access(assetsPath), access(wranglerBin)])

  const config = unstable_readConfig(
    { config: wranglerConfigPath },
    { hideWarnings: true },
  )
  assert.equal(config.main, workerPath, 'Wrangler must run the current OpenNext Worker')
  assert.equal(config.assets?.binding, 'ASSETS', 'Wrangler ASSETS binding is missing')
  assert.equal(config.vars?.PHOTO_UPLOAD_DRIVER, 'r2', 'Worker media driver must be R2')
  const hyperdrive = config.hyperdrive?.find(binding => binding.binding === databaseBinding)
  const bucket = config.r2_buckets?.find(binding => binding.binding === mediaBinding)
  assert(hyperdrive, `${databaseBinding} Hyperdrive binding is missing`)
  assert(bucket?.bucket_name, `${mediaBinding} R2 binding is missing`)

  if (shutdownExitCode !== null) return
  fixtureCreationPromise = createDatabaseFixture()
  const fixture = await fixtureCreationPromise
  fixtureCleanup = fixture.cleanup
  if (shutdownExitCode !== null) {
    await cleanupResources()
    return
  }

  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'cs2cup-worker-smoke-'))
    const primaryState = join(temporaryRoot, 'primary-state')
    const wrongDatabaseState = join(temporaryRoot, 'wrong-database-state')
    const wrongMediaState = join(temporaryRoot, 'wrong-media-state')
    const emptyEnvironmentPath = join(temporaryRoot, 'empty.env')
    const primaryEnvironmentPath = join(temporaryRoot, 'primary.env')
    await Promise.all([
      mkdir(primaryState),
      mkdir(wrongDatabaseState),
      mkdir(wrongMediaState),
      writeFile(emptyEnvironmentPath, '', { mode: 0o600 }),
      writeFile(
        primaryEnvironmentPath,
        adminPepper
          ? `ADMIN_AUTH_PEPPER=${adminPepper}\nNEXT_PUBLIC_SITE_URL=${siteOrigin}\n`
          : '',
        { mode: 0o600 },
      ),
    ])

    const marker = Buffer.from(`cs2cup-worker-r2-smoke-${process.pid}`)
    await runWranglerR2Put({
      bucketName: bucket.bucket_name,
      key: fixture.storageKey,
      persistencePath: primaryState,
      body: marker,
    })

    const primary = await startWorker({
      configPath: wranglerConfigPath,
      envFilePath: primaryEnvironmentPath,
      persistencePath: primaryState,
      bindingName: databaseBinding,
      variables: siteOrigin ? { NEXT_PUBLIC_SITE_URL: siteOrigin } : {},
    })
    try {
      const homepage = await fetchWithTimeout(`${primary.baseUrl}/`)
      const homepageBody = await homepage.text()
      assert.equal(homepage.status, 200, 'Worker homepage request failed')
      assert.equal(homepage.headers.get('x-opennext'), '1', 'Homepage bypassed OpenNext')
      assert(homepageBody.includes(fixture.clubName), 'Homepage did not read the validation database')

      const media = await fetchWithTimeout(
        `${primary.baseUrl}${encodedMediaPath(fixture.storageKey)}`,
      )
      const mediaBody = Buffer.from(await media.arrayBuffer())
      assert.equal(media.status, 200, 'Worker could not read the local R2 object')
      assert.equal(media.headers.get('x-opennext'), '1', 'Media request bypassed OpenNext')
      assert.deepEqual(mediaBody, marker, 'Worker returned the wrong local R2 object')
      await exerciseAdministratorLogin(primary)
    } finally {
      await stopWorker(primary)
    }

    const wrongDatabaseConfigPath = join(temporaryRoot, 'wrong-database.json')
    const wrongDatabaseBinding = 'CS2CUP_DATABASE_WRONG'
    await writeFile(
      wrongDatabaseConfigPath,
      JSON.stringify(generatedConfig(config, {
        name: 'wrong-database',
        databaseBindingName: wrongDatabaseBinding,
        mediaBindingName: mediaBinding,
      })),
      { mode: 0o600 },
    )
    const wrongDatabase = await startWorker({
      configPath: wrongDatabaseConfigPath,
      envFilePath: emptyEnvironmentPath,
      persistencePath: wrongDatabaseState,
      bindingName: wrongDatabaseBinding,
    })
    try {
      await expectUnavailable(wrongDatabase, fixture.storageKey, databaseBinding)
    } finally {
      await stopWorker(wrongDatabase)
    }

    const wrongMediaConfigPath = join(temporaryRoot, 'wrong-media.json')
    await writeFile(
      wrongMediaConfigPath,
      JSON.stringify(generatedConfig(config, {
        name: 'wrong-media',
        databaseBindingName: databaseBinding,
        mediaBindingName: 'CS2CUP_MEDIA_WRONG',
      })),
      { mode: 0o600 },
    )
    const wrongMedia = await startWorker({
      configPath: wrongMediaConfigPath,
      envFilePath: emptyEnvironmentPath,
      persistencePath: wrongMediaState,
      bindingName: databaseBinding,
    })
    try {
      await expectUnavailable(wrongMedia, fixture.storageKey, mediaBinding)
    } finally {
      await stopWorker(wrongMedia)
    }

    console.log('Cloudflare Worker local runtime smoke passed')
  } finally {
    await cleanupResources()
  }
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    shutdownExitCode = exitCode
    void (async () => {
      try {
        const fixture = await fixtureCreationPromise
        if (fixture) fixtureCleanup ??= fixture.cleanup
      } catch (error) {
        console.error(error)
      }
      try {
        await cleanupResources()
      } catch (error) {
        console.error(error)
      }
      process.exit(exitCode)
    })()
  })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
