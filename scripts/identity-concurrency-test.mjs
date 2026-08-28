import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`
const database = `cs2cup_identity_${suffix}`

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
        '-X',
        '-U',
        'postgres',
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-At',
        '-q',
        '-f',
        '-',
      ],
      { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
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

async function ensureIdentity(provider, issuer, subject) {
  const output = await runPsql(`
    select public.ensure_principal_identity(
      ${sqlLiteral(provider)},
      ${sqlLiteral(issuer)},
      ${sqlLiteral(subject)}
    )::text;
  `)
  return JSON.parse(output)
}

async function identitySummary(provider, issuers, subject) {
  const issuerList = issuers.map(sqlLiteral).join(', ')
  const output = await runPsql(`
    with selected_identity as (
      select identity.principal_id
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

const provider = 'cloudbase'
const issuerA = `https://identity-concurrency-a-${suffix}.example`
const issuerB = `https://identity-concurrency-b-${suffix}.example`
const subject = `shared-subject-${suffix}`
let databaseCreated = false
let primaryError = null
let cleanupError = null

try {
  dockerPsql('postgres', `create database ${database};`)
  databaseCreated = true
  runMigration()

  const concurrentResults = await Promise.all(
    Array.from({ length: 8 }, () => ensureIdentity(provider, issuerA, subject)),
  )

  assert.equal(
    concurrentResults.filter(result => result.created === true).length,
    1,
    JSON.stringify(concurrentResults),
  )
  assert.equal(
    new Set(concurrentResults.map(result => result.principalId)).size,
    1,
    JSON.stringify(concurrentResults),
  )
  assert.ok(concurrentResults.every(result => result.ok === true))

  const concurrentSummary = await identitySummary(provider, [issuerA], subject)
  assert.deepEqual(concurrentSummary, {
    identityCount: 1,
    distinctPrincipalCount: 1,
    principalCount: 1,
    creationAuditCount: 1,
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
    invalidCreationAuditActorCount: 0,
    orphanIdentityCount: 0,
    orphanCreationAuditCount: 0,
  })

  console.log('principal identity concurrency and namespace tests passed')
} catch (error) {
  primaryError = error
} finally {
  if (databaseCreated) {
    try {
      dockerPsql('postgres', `drop database ${database} with (force);`)
    } catch (error) {
      cleanupError = error
    }
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
