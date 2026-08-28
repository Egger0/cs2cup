import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`
const database = `cs2cup_identity_${suffix}`
const PROCESS_TIMEOUT_MS = 20_000
const POLL_INTERVAL_MS = 100
const activePsqlSessions = new Set()

if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('Generated identity test database name is unsafe')
}

function dockerPsql(databaseName, sql) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      databaseName,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-q',
      '-f',
      '-',
    ],
    { cwd: ROOT, encoding: 'utf8', input: sql },
  )

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`psql failed for ${databaseName} with exit code ${result.status}`)
  }
  return result.stdout.trim()
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function psqlArguments(databaseName, applicationName) {
  const args = ['compose', 'exec', '-T']
  if (applicationName) {
    if (!/^[a-zA-Z0-9_]+$/.test(applicationName)) {
      throw new Error('Generated PostgreSQL application name is unsafe')
    }
    args.push('-e', `PGAPPNAME=${applicationName}`)
  }
  args.push(
    'db',
    'psql',
    '-X',
    '-U',
    'postgres',
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-q',
    '-f',
    '-',
  )
  return args
}

function startPsqlSession(databaseName, applicationName) {
  const child = spawn('docker', psqlArguments(databaseName, applicationName), {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const session = {
    child,
    error: null,
    exited: false,
    exitCode: null,
    stderr: '',
    stdout: '',
  }
  activePsqlSessions.add(session)

  child.stdout.setEncoding('utf8').on('data', chunk => {
    session.stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', chunk => {
    session.stderr += chunk
  })
  child.stdin.on('error', error => {
    if (error.code !== 'EPIPE') session.error ??= error
  })

  session.exit = new Promise(resolve => {
    child.once('error', error => {
      session.error = error
      session.exited = true
      activePsqlSessions.delete(session)
      resolve()
    })
    child.once('exit', code => {
      session.exitCode = code
      session.exited = true
      activePsqlSessions.delete(session)
      resolve()
    })
  })

  return session
}

async function withTimeout(promise, label, timeoutMs = PROCESS_TIMEOUT_MS) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function waitForSessionOutput(session, marker, label) {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  while (!session.stdout.includes(marker)) {
    if (session.error) throw session.error
    if (session.exited) {
      throw new Error(
        `${label} exited with ${session.exitCode}: ${session.stderr.trim()}`,
      )
    }
    if (Date.now() >= deadline) {
      throw new Error(`${label} timed out; stderr: ${session.stderr.trim()}`)
    }
    await delay(POLL_INTERVAL_MS)
  }
}

async function closePsqlSession(session) {
  if (!session || session.exited) return
  session.child.stdin.end()
  try {
    await withTimeout(session.exit, 'persistent psql shutdown', 2_000)
  } catch (error) {
    session.child.kill('SIGTERM')
    await withTimeout(session.exit, 'forced persistent psql shutdown', 2_000)
    throw error
  }
}

async function terminateActivePsqlSessions() {
  const sessions = [...activePsqlSessions]
  for (const session of sessions) session.child.kill('SIGTERM')
  await Promise.allSettled(
    sessions.map(session =>
      withTimeout(session.exit, 'active psql shutdown', 2_000),
    ),
  )
}

function runMigration() {
  const environment = { ...process.env, MIGRATION_DB_NAME: database }
  delete environment.MIGRATION_DATABASE_URL
  delete environment.MIGRATION_EXPECT_DATABASE
  delete environment.MIGRATION_TEST_MAX_VERSION
  delete environment.MIGRATION_ENABLE_TEST_CONTROLS

  const result = spawnSync(process.execPath, ['scripts/migrate.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: environment,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`Identity test migration failed with exit code ${result.status}`)
  }
}

async function runPsql(sql, applicationName) {
  const guardedSql = `set request.jwt.claims = '{"role":"service_role"}';\n${sql}`
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.end(guardedSql)
  await withTimeout(session.exit, `psql ${applicationName ?? 'query'}`)
  if (session.error) throw session.error
  if (session.exitCode !== 0) {
    throw new Error(`psql exited with ${session.exitCode}: ${session.stderr.trim()}`)
  }
  return session.stdout.trim()
}

async function ensureIdentity(provider, issuer, subject, applicationName) {
  const output = await runPsql(`
    select public.ensure_principal_identity(
      ${sqlLiteral(provider)},
      ${sqlLiteral(issuer)},
      ${sqlLiteral(subject)}
    )::text;
  `, applicationName)
  return JSON.parse(output)
}

async function identitySummary(provider, issuers, subject) {
  const issuerList = issuers.map(sqlLiteral).join(', ')
  const output = await runPsql(`
    with selected_identity as (
      select
        identity.principal_id,
        identity.created_at,
        identity.last_verified_at
      from app_private.principal_identity identity
      where identity.provider = ${sqlLiteral(provider)}
        and identity.issuer in (${issuerList})
        and identity.subject = ${sqlLiteral(subject)}
    )
    select pg_catalog.jsonb_build_object(
      'identityCount', (select count(*) from selected_identity),
      'distinctPrincipalCount', (
        select count(distinct principal_id) from selected_identity
      ),
      'principalCount', (
        select count(*)
        from app_private.principal principal
        where principal.id in (select principal_id from selected_identity)
      ),
      'creationAuditCount', (
        select count(*)
        from app_private.audit_event audit
        where audit.action = 'principal.created'
          and audit.entity_type = 'principal'
          and audit.entity_id in (
            select principal_id::text from selected_identity
          )
      ),
      'invalidVerificationTimestampCount', (
        select count(*)
        from selected_identity
        where last_verified_at < created_at
      ),
      'invalidCreationAuditActorCount', (
        select count(*)
        from app_private.audit_event audit
        where audit.action = 'principal.created'
          and audit.entity_type = 'principal'
          and audit.entity_id in (
            select principal_id::text from selected_identity
          )
          and (
            audit.actor_type <> 'system'
            or audit.actor_principal_id is not null
          )
      ),
      'orphanIdentityCount', (
        select count(*)
        from app_private.principal_identity identity
        left join app_private.principal principal
          on principal.id = identity.principal_id
        where principal.id is null
      ),
      'orphanCreationAuditCount', (
        select count(*)
        from app_private.audit_event audit
        left join app_private.principal principal
          on principal.id::text = audit.entity_id
        where audit.action = 'principal.created'
          and audit.entity_type = 'principal'
          and principal.id is null
      )
    )::text;
  `)
  return JSON.parse(output)
}

function identityAdvisoryLockSql(provider, issuer, subject) {
  return `pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(
        ${sqlLiteral(provider)},
        ${sqlLiteral(issuer)},
        ${sqlLiteral(subject)}
      )::text,
      20260828
    )
  )`
}

async function waitForAdvisoryWaiters(applicationNames) {
  const applicationList = applicationNames.map(sqlLiteral).join(', ')
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = JSON.parse(
      dockerPsql(database, `
        select pg_catalog.jsonb_build_object(
          'sessionCount', count(*),
          'distinctApplicationCount', count(distinct application_name),
          'advisoryWaitCount', count(*) filter (
            where state = 'active'
              and wait_event_type = 'Lock'
              and wait_event = 'advisory'
          )
        )::text
        from pg_catalog.pg_stat_activity
        where datname = ${sqlLiteral(database)}
          and application_name in (${applicationList});
      `),
    )

    if (
      latest.sessionCount === applicationNames.length
      && latest.distinctApplicationCount === applicationNames.length
      && latest.advisoryWaitCount === applicationNames.length
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error(
    `resolver sessions did not all reach advisory wait: ${JSON.stringify(latest)}`,
  )
}

function parseMarkedJson(output, beginMarker, endMarker) {
  const begin = output.indexOf(beginMarker)
  const end = output.indexOf(endMarker, begin + beginMarker.length)
  if (begin < 0 || end < 0) {
    throw new Error(`missing marked JSON output: ${beginMarker}/${endMarker}`)
  }
  const value = output.slice(begin + beginMarker.length, end).trim()
  return JSON.parse(value)
}

const provider = 'cloudbase'
const issuerA = `https://identity-concurrency-a-${suffix}.example`
const issuerB = `https://identity-concurrency-b-${suffix}.example`
const subject = `shared-subject-${suffix}`
const holderApplicationName = `identity_holder_${suffix}`
const resolverApplicationNames = Array.from(
  { length: 8 },
  (_, index) => `identity_waiter_${suffix}_${index}`,
)
const lockAcquiredMarker = `LOCK_ACQUIRED_${suffix}`
const holderResultBeginMarker = `HOLDER_RESULT_BEGIN_${suffix}`
const holderResultEndMarker = `HOLDER_RESULT_END_${suffix}`
const holderCommittedMarker = `HOLDER_COMMITTED_${suffix}`
let databaseCreated = false
let holderSession = null
let primaryError = null
let cleanupError = null

try {
  dockerPsql('postgres', `create database ${database};`)
  databaseCreated = true
  runMigration()

  holderSession = startPsqlSession(database, holderApplicationName)
  holderSession.child.stdin.write(`\\set ON_ERROR_STOP on
    begin;
    select ${identityAdvisoryLockSql(provider, issuerA, subject)};
\\echo ${lockAcquiredMarker}
  `)
  await waitForSessionOutput(holderSession, lockAcquiredMarker, 'identity lock holder')

  const resolverSettlementsPromise = Promise.allSettled(
    resolverApplicationNames.map(applicationName =>
      ensureIdentity(provider, issuerA, subject, applicationName),
    ),
  )
  const waitSummary = await waitForAdvisoryWaiters(resolverApplicationNames)
  assert.deepEqual(waitSummary, {
    sessionCount: 8,
    distinctApplicationCount: 8,
    advisoryWaitCount: 8,
  })

  holderSession.child.stdin.write(`set local request.jwt.claims = '{"role":"service_role"}';
\\echo ${holderResultBeginMarker}
    select public.ensure_principal_identity(
      ${sqlLiteral(provider)},
      ${sqlLiteral(issuerA)},
      ${sqlLiteral(subject)}
    )::text;
\\echo ${holderResultEndMarker}
    commit;
\\echo ${holderCommittedMarker}
  `)
  await waitForSessionOutput(holderSession, holderCommittedMarker, 'identity lock holder commit')

  const holderResult = parseMarkedJson(
    holderSession.stdout,
    holderResultBeginMarker,
    holderResultEndMarker,
  )
  assert.equal(holderResult.ok, true, JSON.stringify(holderResult))
  assert.equal(holderResult.created, true, JSON.stringify(holderResult))

  const resolverSettlements = await withTimeout(
    resolverSettlementsPromise,
    'blocked identity resolvers',
  )
  const resolverFailures = resolverSettlements
    .filter(result => result.status === 'rejected')
    .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason))
  assert.deepEqual(resolverFailures, [])
  const concurrentResults = resolverSettlements.map(result => result.value)

  assert.equal(
    concurrentResults.filter(result => result.created !== false).length,
    0,
    JSON.stringify(concurrentResults),
  )
  assert.equal(
    new Set(concurrentResults.map(result => result.principalId)).size,
    1,
    JSON.stringify(concurrentResults),
  )
  assert.ok(concurrentResults.every(result => result.ok === true))
  assert.ok(
    concurrentResults.every(result => result.principalId === holderResult.principalId),
    JSON.stringify(concurrentResults),
  )

  const concurrentSummary = await identitySummary(provider, [issuerA], subject)
  assert.deepEqual(concurrentSummary, {
    identityCount: 1,
    distinctPrincipalCount: 1,
    principalCount: 1,
    creationAuditCount: 1,
    invalidVerificationTimestampCount: 0,
    invalidCreationAuditActorCount: 0,
    orphanIdentityCount: 0,
    orphanCreationAuditCount: 0,
  })

  const otherIssuer = await ensureIdentity(provider, issuerB, subject)
  assert.equal(otherIssuer.ok, true)
  assert.equal(otherIssuer.created, true)
  assert.notEqual(otherIssuer.principalId, concurrentResults[0].principalId)

  const namespaceSummary = await identitySummary(provider, [issuerA, issuerB], subject)
  assert.deepEqual(namespaceSummary, {
    identityCount: 2,
    distinctPrincipalCount: 2,
    principalCount: 2,
    creationAuditCount: 2,
    invalidVerificationTimestampCount: 0,
    invalidCreationAuditActorCount: 0,
    orphanIdentityCount: 0,
    orphanCreationAuditCount: 0,
  })

  console.log('principal identity concurrency and namespace tests passed')
} catch (error) {
  primaryError = error
} finally {
  const cleanupErrors = []
  try {
    await closePsqlSession(holderSession)
  } catch (error) {
    cleanupErrors.push(error)
  }

  let firstDropError = null
  if (databaseCreated) {
    try {
      dockerPsql('postgres', `drop database ${database} with (force);`)
    } catch (error) {
      firstDropError = error
    }
  }

  await terminateActivePsqlSessions()

  if (firstDropError) {
    try {
      dockerPsql('postgres', `drop database ${database} with (force);`)
    } catch (retryError) {
      cleanupErrors.push(
        new AggregateError(
          [firstDropError, retryError],
          'Identity test database cleanup failed twice',
        ),
      )
    }
  }

  if (cleanupErrors.length === 1) cleanupError = cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    cleanupError = new AggregateError(cleanupErrors, 'Identity test cleanup failed')
  }
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    'Principal identity concurrency test and cleanup failed',
  )
}
if (primaryError) throw primaryError
if (cleanupError) throw cleanupError
