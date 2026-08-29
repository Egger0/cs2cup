import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const database = process.env.TEST_DB_NAME
if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error(
    'TEST_DB_NAME is required and must contain only letters, digits and underscores',
  )
}

function runPsql(sql) {
  const guardedSql = `set request.jwt.claims = '{"role":"service_role"}';\n${sql}`
  return new Promise((resolve, reject) => {
    const child = spawn(
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
        database,
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-q',
        '-f',
        '-',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`psql exited with ${code}: ${stderr.trim()}`))
    })
    child.stdin.end(guardedSql)
  })
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function randomFingerprint() {
  return randomBytes(32).toString('hex')
}

function fingerprintSql(fingerprint) {
  assert.match(fingerprint, /^[0-9a-f]{64}$/)
  return `pg_catalog.decode(${sqlLiteral(fingerprint)}, 'hex')`
}

function fingerprintArraySql(fingerprints) {
  assert.ok(fingerprints.length > 0)
  return `array[${fingerprints.map(fingerprintSql).join(',')}]::bytea[]`
}

async function callBeginLogin(accountFingerprint, networkFingerprint, username) {
  const output = await runPsql(`
    select public.begin_local_admin_login(
      ${fingerprintSql(accountFingerprint)},
      ${fingerprintSql(networkFingerprint)},
      ${sqlLiteral(username)}
    )::text;
  `)
  return JSON.parse(output)
}

function assertBeginResult(result, username) {
  assert.equal(result?.ok, true, JSON.stringify(result))
  assert.equal(typeof result.allowed, 'boolean', JSON.stringify(result))

  if (!result.allowed) {
    assert.deepEqual(
      Object.keys(result).sort(),
      ['allowed', 'ok', 'retryAfterSeconds'],
      JSON.stringify(result),
    )
    assert.ok(Number.isInteger(result.retryAfterSeconds), JSON.stringify(result))
    assert.ok(
      result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= 900,
      JSON.stringify(result),
    )
    return
  }

  assert.deepEqual(
    Object.keys(result).sort(),
    ['allowed', 'credential', 'ok'],
    JSON.stringify(result),
  )
  assert.deepEqual(
    Object.keys(result.credential).sort(),
    [
      'algorithm',
      'credentialVersion',
      'hashHex',
      'iterations',
      'principalId',
      'saltHex',
      'username',
    ],
    JSON.stringify(result),
  )
  assert.deepEqual(result.credential, {
    principalId: '00000000-0000-4000-8000-000000000000',
    username,
    algorithm: 'pbkdf2-hmac-sha256',
    iterations: 600000,
    credentialVersion: 1,
    saltHex: '00'.repeat(16),
    hashHex: '00'.repeat(32),
  })
}

async function sideEffectState() {
  return JSON.parse(await runPsql(`
    select pg_catalog.jsonb_build_object(
      'roles', (select pg_catalog.count(*) from pg_catalog.pg_roles),
      'principals', (select pg_catalog.count(*) from app_private.principal),
      'identities', (
        select pg_catalog.count(*) from app_private.principal_identity
      ),
      'credentials', (
        select pg_catalog.count(*) from app_private.local_admin_credential
      ),
      'administrators', (select pg_catalog.count(*) from public.admin_user),
      'sessions', (select pg_catalog.count(*) from app_private.app_session),
      'tokens', (select pg_catalog.count(*) from app_private.app_session_token),
      'audits', (select pg_catalog.count(*) from app_private.audit_event),
      'throttles', (select pg_catalog.count(*) from app_private.login_throttle)
    )::text;
  `))
}

const suffix = randomUUID().replaceAll('-', '')
const accountAttemptCount = 8
const networkAttemptCount = 36
const accountUsername = `local-admin-account-concurrency-${suffix}`
const networkUsernames = Array.from(
  { length: networkAttemptCount },
  (_, index) => `local-admin-network-concurrency-${suffix}-${index}`,
)

const sharedAccountFingerprint = randomFingerprint()
const accountNetworkFingerprints = Array.from(
  { length: accountAttemptCount },
  randomFingerprint,
)
const sharedNetworkFingerprint = randomFingerprint()
const networkAccountFingerprints = Array.from(
  { length: networkAttemptCount },
  randomFingerprint,
)
const accountFingerprints = [sharedAccountFingerprint, ...networkAccountFingerprints]
const networkFingerprints = [...accountNetworkFingerprints, sharedNetworkFingerprint]

assert.equal(new Set(accountFingerprints).size, accountFingerprints.length)
assert.equal(new Set(networkFingerprints).size, networkFingerprints.length)

const exactThrottlePredicate = `
  (scope = 'account' and fingerprint = any(
    ${fingerprintArraySql(accountFingerprints)}
  ))
  or
  (scope = 'network' and fingerprint = any(
    ${fingerprintArraySql(networkFingerprints)}
  ))
`

let baselineState
let cleanupNeeded = false
let testFailure
let cleanupFailure

try {
  const connectedDatabase = await runPsql('select pg_catalog.current_database();')
  assert.equal(
    connectedDatabase,
    database,
    `psql connected to ${connectedDatabase || '(unknown)'} instead of ${database}`,
  )

  const readiness = JSON.parse(await runPsql(`
    select pg_catalog.jsonb_build_object(
      'beginRpc', to_regprocedure(
        'public.begin_local_admin_login(bytea,bytea,text)'
      ) is not null,
      'expand022', exists (
        select 1
        from public.schema_migration
        where phase = 'expand'
          and filename = '022_local_admin_authentication.sql'
      ),
      'contract022', exists (
        select 1
        from public.schema_migration
        where phase = 'contract'
          and filename = '022_activate_local_admin_sessions.sql'
      )
    )::text;
  `))
  assert.deepEqual(readiness, {
    beginRpc: true,
    expand022: true,
    contract022: true,
  })

  baselineState = await sideEffectState()
  const preexistingThrottleRows = Number(await runPsql(`
    select pg_catalog.count(*)
    from app_private.login_throttle
    where ${exactThrottlePredicate};
  `))
  assert.equal(preexistingThrottleRows, 0, 'random throttle fingerprints already exist')

  cleanupNeeded = true
  const accountResults = await Promise.all(
    accountNetworkFingerprints.map(networkFingerprint =>
      callBeginLogin(
        sharedAccountFingerprint,
        networkFingerprint,
        accountUsername,
      ),
    ),
  )
  for (const result of accountResults) assertBeginResult(result, accountUsername)
  assert.equal(
    accountResults.filter(result => result.allowed).length,
    5,
    JSON.stringify(accountResults),
  )
  assert.equal(
    accountResults.filter(result => !result.allowed).length,
    accountAttemptCount - 5,
    JSON.stringify(accountResults),
  )

  const accountThrottleState = JSON.parse(await runPsql(`
    select pg_catalog.jsonb_build_object(
      'accountAttemptCount', coalesce((
        select throttle.attempt_count
        from app_private.login_throttle throttle
        where throttle.scope = 'account'
          and throttle.fingerprint = ${fingerprintSql(sharedAccountFingerprint)}
      ), -1),
      'accountBlocked', coalesce((
        select throttle.blocked_until > pg_catalog.clock_timestamp()
        from app_private.login_throttle throttle
        where throttle.scope = 'account'
          and throttle.fingerprint = ${fingerprintSql(sharedAccountFingerprint)}
      ), false),
      'networkRows', (
        select pg_catalog.count(*)
        from app_private.login_throttle throttle
        where throttle.scope = 'network'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(accountNetworkFingerprints)}
          )
      ),
      'networkAttempts', (
        select coalesce(pg_catalog.sum(throttle.attempt_count), 0)
        from app_private.login_throttle throttle
        where throttle.scope = 'network'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(accountNetworkFingerprints)}
          )
      ),
      'networkBlockedRows', (
        select pg_catalog.count(*)
        from app_private.login_throttle throttle
        where throttle.scope = 'network'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(accountNetworkFingerprints)}
          )
          and throttle.blocked_until is not null
      )
    )::text;
  `))
  assert.deepEqual(accountThrottleState, {
    accountAttemptCount: 6,
    accountBlocked: true,
    networkRows: accountAttemptCount,
    networkAttempts: accountAttemptCount,
    networkBlockedRows: 0,
  })

  const networkResults = await Promise.all(
    networkAccountFingerprints.map((accountFingerprint, index) =>
      callBeginLogin(
        accountFingerprint,
        sharedNetworkFingerprint,
        networkUsernames[index],
      ),
    ),
  )
  networkResults.forEach((result, index) => {
    assertBeginResult(result, networkUsernames[index])
  })
  assert.equal(
    networkResults.filter(result => result.allowed).length,
    30,
    JSON.stringify(networkResults),
  )
  assert.equal(
    networkResults.filter(result => !result.allowed).length,
    networkAttemptCount - 30,
    JSON.stringify(networkResults),
  )

  const networkThrottleState = JSON.parse(await runPsql(`
    select pg_catalog.jsonb_build_object(
      'networkAttemptCount', coalesce((
        select throttle.attempt_count
        from app_private.login_throttle throttle
        where throttle.scope = 'network'
          and throttle.fingerprint = ${fingerprintSql(sharedNetworkFingerprint)}
      ), -1),
      'networkBlocked', coalesce((
        select throttle.blocked_until > pg_catalog.clock_timestamp()
        from app_private.login_throttle throttle
        where throttle.scope = 'network'
          and throttle.fingerprint = ${fingerprintSql(sharedNetworkFingerprint)}
      ), false),
      'accountRows', (
        select pg_catalog.count(*)
        from app_private.login_throttle throttle
        where throttle.scope = 'account'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(networkAccountFingerprints)}
          )
      ),
      'accountAttempts', (
        select coalesce(pg_catalog.sum(throttle.attempt_count), 0)
        from app_private.login_throttle throttle
        where throttle.scope = 'account'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(networkAccountFingerprints)}
          )
      ),
      'accountBlockedRows', (
        select pg_catalog.count(*)
        from app_private.login_throttle throttle
        where throttle.scope = 'account'
          and throttle.fingerprint = any(
            ${fingerprintArraySql(networkAccountFingerprints)}
          )
          and throttle.blocked_until is not null
      )
    )::text;
  `))
  assert.deepEqual(networkThrottleState, {
    networkAttemptCount: 31,
    networkBlocked: true,
    // Calls serialized after the 31st network attempt must not create account
    // rows for sprayed usernames.
    accountRows: 30,
    accountAttempts: 30,
    accountBlockedRows: 0,
  })

  console.log('local administrator authentication concurrency test passed')
} catch (error) {
  testFailure = error
} finally {
  if (cleanupNeeded) {
    try {
      await runPsql(`
        delete from app_private.login_throttle
        where ${exactThrottlePredicate};
      `)

      const remainingThrottleRows = Number(await runPsql(`
        select pg_catalog.count(*)
        from app_private.login_throttle
        where ${exactThrottlePredicate};
      `))
      assert.equal(remainingThrottleRows, 0, 'exact throttle cleanup was incomplete')
      assert.deepEqual(
        await sideEffectState(),
        baselineState,
        'login concurrency test left role, identity, session, audit, or throttle state',
      )
    } catch (error) {
      cleanupFailure = error
    }
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError(
    [testFailure, cleanupFailure],
    'concurrency assertions and exact cleanup both failed',
  )
}
if (testFailure) throw testFailure
if (cleanupFailure) throw cleanupFailure
