import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`
const database = `cs2cup_session_${suffix}`
const PROCESS_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 100
const activePsqlSessions = new Set()

if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('Generated session test database name is unsafe')
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
      '-v',
      'VERBOSITY=sqlstate',
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

function uuidSql(value) {
  return `${sqlLiteral(value)}::uuid`
}

function digestSql(hex) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('Generated digest is unsafe')
  return `pg_catalog.decode(${sqlLiteral(hex)}, 'hex')`
}

function randomDigest() {
  return randomBytes(32).toString('hex')
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
    '-v',
    'VERBOSITY=sqlstate',
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
    throw new Error(`Session test migration failed with exit code ${result.status}`)
  }
}

async function runPsql(sql, applicationName) {
  const guardedSql = `set statement_timeout = '20s';
set request.jwt.claims = '{"role":"service_role"}';
${sql}`
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.end(guardedSql)
  await withTimeout(session.exit, `psql ${applicationName ?? 'query'}`)
  if (session.error) throw session.error
  if (session.exitCode !== 0) {
    throw new Error(`psql exited with ${session.exitCode}: ${session.stderr.trim()}`)
  }
  return session.stdout.trim()
}

async function runPsqlExpectSqlState(
  sql,
  applicationName,
  expectedSqlState,
) {
  if (!/^[0-9A-Z]{5}$/.test(expectedSqlState)) {
    throw new Error('Expected SQLSTATE is unsafe')
  }

  const guardedSql = `\\set VERBOSITY sqlstate
set statement_timeout = '20s';
set request.jwt.claims = '{"role":"service_role"}';
${sql}`
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.end(guardedSql)
  await withTimeout(session.exit, `expected-error psql ${applicationName}`)
  if (session.error) throw session.error
  if (session.exitCode === 0) {
    throw new Error(
      `psql ${applicationName} unexpectedly succeeded; expected SQLSTATE ${expectedSqlState}`,
    )
  }

  const observedStates = [...session.stderr.matchAll(/ERROR:\s+([0-9A-Z]{5})/g)]
    .map(match => match[1])
  assert.deepEqual(observedStates, [expectedSqlState])
  return expectedSqlState
}

async function callJson(expression, applicationName) {
  const output = await runPsql(`select (${expression})::text;`, applicationName)
  return JSON.parse(output)
}

function parseMarkedJson(output, beginMarker, endMarker) {
  const begin = output.indexOf(beginMarker)
  const end = output.indexOf(endMarker, begin + beginMarker.length)
  if (begin < 0 || end < 0) {
    throw new Error(`missing marked JSON output: ${beginMarker}/${endMarker}`)
  }
  return JSON.parse(output.slice(begin + beginMarker.length, end).trim())
}

function parseBackendPid(output, beginMarker, endMarker) {
  const backendPid = parseMarkedJson(output, beginMarker, endMarker)
  if (!Number.isSafeInteger(backendPid) || backendPid <= 0) {
    throw new Error('PostgreSQL backend PID marker was invalid')
  }
  return backendPid
}

function lockEvidenceAlias(value) {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error('Lock-evidence SQL alias is unsafe')
  }
  return value
}

function rowWaitSignatureSql(activityAlias, relation, blockerPidPredicate) {
  const alias = lockEvidenceAlias(activityAlias)
  if (typeof blockerPidPredicate !== 'string' || !blockerPidPredicate.trim()) {
    throw new Error('Transaction blocker predicate is required')
  }
  return `(
    ${alias}.state = 'active'
    and ${alias}.wait_event_type = 'Lock'
    and (
      (
        ${alias}.wait_event = 'transactionid'
        and exists (
          select 1
          from pg_catalog.pg_locks waiting_lock
          join pg_catalog.pg_locks blocker_lock
            on blocker_lock.locktype = 'transactionid'
           and blocker_lock.transactionid = waiting_lock.transactionid
           and blocker_lock.mode = 'ExclusiveLock'
           and blocker_lock.granted
          where waiting_lock.pid = ${alias}.pid
            and waiting_lock.locktype = 'transactionid'
            and waiting_lock.mode = 'ShareLock'
            and not waiting_lock.granted
            and (${blockerPidPredicate})
        )
      ) or (
        ${alias}.wait_event = 'tuple'
        and exists (
          select 1
          from pg_catalog.pg_locks waiting_lock
          where waiting_lock.pid = ${alias}.pid
            and waiting_lock.locktype = 'tuple'
            and waiting_lock.relation = ${sqlLiteral(relation)}::regclass
            and not waiting_lock.granted
        )
      )
    )
  )`
}

function relationIntentLockSql(activityAlias, relation, mode) {
  const alias = lockEvidenceAlias(activityAlias)
  if (!['RowShareLock', 'RowExclusiveLock'].includes(mode)) {
    throw new Error('Expected relation intent-lock mode is unsafe')
  }
  return `exists (
    select 1
    from pg_catalog.pg_locks intent_lock
    where intent_lock.pid = ${alias}.pid
      and intent_lock.locktype = 'relation'
      and intent_lock.relation = ${sqlLiteral(relation)}::regclass
      and intent_lock.mode = ${sqlLiteral(mode)}
      and intent_lock.granted
  )`
}

function expectedWaitPhaseSql(activityAlias, relation, mode) {
  const alias = lockEvidenceAlias(activityAlias)
  if (relation !== 'app_private.principal') return 'true'

  // A Principal-first waiter may have completed non-locking family lookups, so
  // AccessShareLock is allowed downstream. RowShareLock/RowExclusiveLock (or a
  // stronger mode) would prove that it already reached a family mutation or
  // locking read and make a Principal-first assertion a false positive.
  return `(
    ${relationIntentLockSql(alias, 'app_private.principal', mode)}
    and not exists (
      select 1
      from pg_catalog.pg_locks downstream_lock
      where downstream_lock.pid = ${alias}.pid
        and downstream_lock.locktype = 'relation'
        and downstream_lock.relation in (
          'app_private.app_session'::regclass,
          'app_private.app_session_token'::regclass,
          'app_private.audit_event'::regclass
        )
        and downstream_lock.mode <> 'AccessShareLock'
        and downstream_lock.granted
    )
  )`
}

async function waitForHolderBlockedWaiters(
  applicationNames,
  holderApplicationName,
  holderBackendPid,
  holderRelation,
  waiterRelationMode,
) {
  if (!Number.isSafeInteger(holderBackendPid) || holderBackendPid <= 0) {
    throw new Error('Holder backend PID is unsafe')
  }
  const applicationList = applicationNames.map(sqlLiteral).join(', ')
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = JSON.parse(
      dockerPsql(database, `
        with recursive waiters as (
          select activity.pid, activity.application_name,
                 activity.state, activity.wait_event_type, activity.wait_event
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name in (${applicationList})
        ), holder as (
          select activity.pid, activity.state
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(holderApplicationName)}
            and activity.pid = ${holderBackendPid}
        ), blocking_edges as (
          select activity.pid as blocked_pid, blocker.pid as blocker_pid
          from pg_catalog.pg_stat_activity activity
          cross join lateral pg_catalog.unnest(
            pg_catalog.pg_blocking_pids(activity.pid)
          ) blocker(pid)
          where activity.datname = ${sqlLiteral(database)}
        ), blocker_chain(waiter_pid, blocker_pid, path) as (
          select
            waiters.pid,
            blocking_edges.blocker_pid,
            array[waiters.pid, blocking_edges.blocker_pid]::integer[]
          from waiters
          join blocking_edges on blocking_edges.blocked_pid = waiters.pid
          union all
          select
            blocker_chain.waiter_pid,
            blocking_edges.blocker_pid,
            blocker_chain.path || blocking_edges.blocker_pid
          from blocker_chain
          join blocking_edges
            on blocking_edges.blocked_pid = blocker_chain.blocker_pid
          where not blocking_edges.blocker_pid = any(blocker_chain.path)
        )
        select pg_catalog.jsonb_build_object(
          'holderCount', (select count(*) from holder),
          'holderIdleInTransactionCount', (
            select count(*) from holder where state = 'idle in transaction'
          ),
          'sessionCount', (select count(*) from waiters),
          'distinctApplicationCount', (
            select count(distinct application_name) from waiters
          ),
          'lockWaitCount', (
            select count(*) from waiters
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'rowWaitSignatureCount', (
            select count(*) from waiters
            where ${rowWaitSignatureSql(
              'waiters',
              holderRelation,
              `blocker_lock.pid in (
                select blocker_chain.blocker_pid
                from blocker_chain
                where blocker_chain.waiter_pid = waiters.pid
              )`,
            )}
          ),
          'waiterRelationIntentLockCount', (
            select count(*) from waiters
            where ${relationIntentLockSql(
              'waiters',
              holderRelation,
              waiterRelationMode,
            )}
          ),
          'expectedWaitPhaseCount', (
            select count(*) from waiters
            where ${expectedWaitPhaseSql(
              'waiters',
              holderRelation,
              waiterRelationMode,
            )}
          ),
          'blockedByHolderCount', (
            select count(distinct blocker_chain.waiter_pid)
            from blocker_chain cross join holder
            where blocker_chain.blocker_pid = holder.pid
          ),
          'holderRelationLockCount', (
            select count(*)
            from holder
            where exists (
              select 1
              from pg_catalog.pg_locks held_lock
              where held_lock.pid = holder.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = ${sqlLiteral(holderRelation)}::regclass
                and held_lock.granted
            )
          )
        )::text;
      `),
    )

    if (
      latest.holderCount === 1
      && latest.holderIdleInTransactionCount === 1
      && latest.sessionCount === applicationNames.length
      && latest.distinctApplicationCount === applicationNames.length
      && latest.lockWaitCount === applicationNames.length
      && latest.rowWaitSignatureCount === applicationNames.length
      && latest.waiterRelationIntentLockCount === applicationNames.length
      && latest.expectedWaitPhaseCount === applicationNames.length
      && latest.blockedByHolderCount === applicationNames.length
      && latest.holderRelationLockCount === 1
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error(
    `sessions did not all reach the expected holder lock: ${JSON.stringify(latest)}`,
  )
}

async function waitForThrottleDeletionGap(
  consumerApplicationName,
  deleterApplicationName,
  holderApplicationName,
  holderBackendPid,
) {
  if (!Number.isSafeInteger(holderBackendPid) || holderBackendPid <= 0) {
    throw new Error('Throttle holder backend PID is unsafe')
  }
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = JSON.parse(
      dockerPsql(database, `
        with consumer as (
          select activity.pid, activity.state,
                 activity.wait_event_type, activity.wait_event
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(consumerApplicationName)}
        ), deleter as (
          select activity.pid, activity.state,
                 activity.wait_event_type, activity.wait_event
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(deleterApplicationName)}
        ), holder as (
          select activity.pid, activity.state
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(holderApplicationName)}
            and activity.pid = ${holderBackendPid}
        )
        select pg_catalog.jsonb_build_object(
          'consumerCount', (select count(*) from consumer),
          'deleterCount', (select count(*) from deleter),
          'holderCount', (select count(*) from holder),
          'holderIdleInTransactionCount', (
            select count(*) from holder where state = 'idle in transaction'
          ),
          'consumerLockWaitCount', (
            select count(*) from consumer
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'deleterLockWaitCount', (
            select count(*) from deleter
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'consumerRowWaitSignatureCount', (
            select count(*) from consumer
            where ${rowWaitSignatureSql(
              'consumer',
              'app_private.login_throttle',
              'blocker_lock.pid in (select deleter.pid from deleter)',
            )}
          ),
          'deleterRowWaitSignatureCount', (
            select count(*) from deleter
            where ${rowWaitSignatureSql(
              'deleter',
              'app_private.login_throttle',
              'blocker_lock.pid in (select holder.pid from holder)',
            )}
          ),
          'deleterBlockedByHolderCount', (
            select count(*)
            from deleter cross join holder
            where holder.pid = any(pg_catalog.pg_blocking_pids(deleter.pid))
          ),
          'consumerBlockedByDeleterCount', (
            select count(*)
            from consumer cross join deleter
            where deleter.pid = any(pg_catalog.pg_blocking_pids(consumer.pid))
          ),
          'holderRowShareLockCount', (
            select count(*)
            from holder
            where exists (
              select 1 from pg_catalog.pg_locks held_lock
              where held_lock.pid = holder.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = 'app_private.login_throttle'::regclass
                and held_lock.mode = 'RowShareLock'
                and held_lock.granted
            )
          ),
          'deleterRowExclusiveLockCount', (
            select count(*)
            from deleter
            where exists (
              select 1 from pg_catalog.pg_locks held_lock
              where held_lock.pid = deleter.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = 'app_private.login_throttle'::regclass
                and held_lock.mode = 'RowExclusiveLock'
                and held_lock.granted
            )
          ),
          'consumerRowExclusiveLockCount', (
            select count(*)
            from consumer
            where exists (
              select 1 from pg_catalog.pg_locks held_lock
              where held_lock.pid = consumer.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = 'app_private.login_throttle'::regclass
                and held_lock.mode = 'RowExclusiveLock'
                and held_lock.granted
            )
          ),
          'consumerRowShareLockCount', (
            select count(*)
            from consumer
            where exists (
              select 1 from pg_catalog.pg_locks held_lock
              where held_lock.pid = consumer.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = 'app_private.login_throttle'::regclass
                and held_lock.mode = 'RowShareLock'
                and held_lock.granted
            )
          )
        )::text;
      `),
    )

    if (Object.values(latest).every(value => value === 1)) return latest
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error(
    `throttle consumer did not reach the post-conflict row-lock queue: ${JSON.stringify(latest)}`,
  )
}

async function waitForBlockingPidWaiter(
  waiterApplicationName,
  holderApplicationName,
  holderBackendPid,
  holderRelation,
  waiterRelationMode,
) {
  if (!Number.isSafeInteger(holderBackendPid) || holderBackendPid <= 0) {
    throw new Error('Holder backend PID is unsafe')
  }
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = JSON.parse(
      dockerPsql(database, `
        with waiter as (
          select activity.pid, activity.state,
                 activity.wait_event_type, activity.wait_event
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(waiterApplicationName)}
        ), holder as (
          select activity.pid, activity.state
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(holderApplicationName)}
            and activity.pid = ${holderBackendPid}
        )
        select pg_catalog.jsonb_build_object(
          'waiterCount', (select count(*) from waiter),
          'holderIdleInTransactionCount', (
            select count(*) from holder where state = 'idle in transaction'
          ),
          'lockWaitCount', (
            select count(*) from waiter
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'rowWaitSignatureCount', (
            select count(*) from waiter
            where ${rowWaitSignatureSql(
              'waiter',
              holderRelation,
              'blocker_lock.pid in (select holder.pid from holder)',
            )}
          ),
          'waiterRelationIntentLockCount', (
            select count(*) from waiter
            where ${relationIntentLockSql(
              'waiter',
              holderRelation,
              waiterRelationMode,
            )}
          ),
          'expectedWaitPhaseCount', (
            select count(*) from waiter
            where ${expectedWaitPhaseSql(
              'waiter',
              holderRelation,
              waiterRelationMode,
            )}
          ),
          'blockedByHolderCount', (
            select count(*)
            from waiter cross join holder
            where holder.pid = any(pg_catalog.pg_blocking_pids(waiter.pid))
          ),
          'holderRelationLockCount', (
            select count(*)
            from holder
            where exists (
              select 1
              from pg_catalog.pg_locks held_lock
              where held_lock.pid = holder.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = ${sqlLiteral(holderRelation)}::regclass
                and held_lock.granted
            )
          )
        )::text;
      `),
    )

    if (
      latest.waiterCount === 1
      && latest.holderIdleInTransactionCount === 1
      && latest.lockWaitCount === 1
      && latest.rowWaitSignatureCount === 1
      && latest.waiterRelationIntentLockCount === 1
      && latest.expectedWaitPhaseCount === 1
      && latest.blockedByHolderCount === 1
      && latest.holderRelationLockCount === 1
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error(
    `operation did not reach the expected holder lock: ${JSON.stringify(latest)}`,
  )
}

async function assertBlockedByHolder(
  waiterApplicationName,
  holderApplicationName,
  holderBackendPid,
  holderRelation,
  waiterRelationMode,
) {
  assert.deepEqual(
    await waitForBlockingPidWaiter(
      waiterApplicationName,
      holderApplicationName,
      holderBackendPid,
      holderRelation,
      waiterRelationMode,
    ),
    {
      waiterCount: 1,
      holderIdleInTransactionCount: 1,
      lockWaitCount: 1,
      rowWaitSignatureCount: 1,
      waiterRelationIntentLockCount: 1,
      expectedWaitPhaseCount: 1,
      blockedByHolderCount: 1,
      holderRelationLockCount: 1,
    },
  )
}

async function waitForPrincipalLockWaiter(
  waiterApplicationName,
  holderApplicationName,
  holderBackendPid,
) {
  if (!Number.isSafeInteger(holderBackendPid) || holderBackendPid <= 0) {
    throw new Error('Principal holder backend PID is unsafe')
  }
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = JSON.parse(
      dockerPsql(database, `
        with waiter as (
          select activity.pid, activity.state,
                 activity.wait_event_type, activity.wait_event
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(waiterApplicationName)}
        ), holder as (
          select activity.pid, activity.state
          from pg_catalog.pg_stat_activity activity
          where activity.datname = ${sqlLiteral(database)}
            and activity.application_name = ${sqlLiteral(holderApplicationName)}
            and activity.pid = ${holderBackendPid}
        )
        select pg_catalog.jsonb_build_object(
          'waiterCount', (select count(*) from waiter),
          'holderIdleInTransactionCount', (
            select count(*) from holder where state = 'idle in transaction'
          ),
          'lockWaitCount', (
            select count(*) from waiter
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'rowWaitSignatureCount', (
            select count(*) from waiter
            where ${rowWaitSignatureSql(
              'waiter',
              'app_private.principal',
              'blocker_lock.pid in (select holder.pid from holder)',
            )}
          ),
          'waiterRelationIntentLockCount', (
            select count(*) from waiter
            where ${relationIntentLockSql(
              'waiter',
              'app_private.principal',
              'RowShareLock',
            )}
          ),
          'expectedWaitPhaseCount', (
            select count(*) from waiter
            where ${expectedWaitPhaseSql(
              'waiter',
              'app_private.principal',
              'RowShareLock',
            )}
          ),
          'blockedByHolderCount', (
            select count(*)
            from waiter cross join holder
            where holder.pid = any(pg_catalog.pg_blocking_pids(waiter.pid))
          ),
          'holderPrincipalRelationLockCount', (
            select count(*)
            from holder
            where exists (
              select 1
              from pg_catalog.pg_locks held_lock
              where held_lock.pid = holder.pid
                and held_lock.locktype = 'relation'
                and held_lock.relation = 'app_private.principal'::regclass
                and held_lock.mode = 'RowShareLock'
                and held_lock.granted
            )
          )
        )::text;
      `),
    )

    if (
      latest.waiterCount === 1
      && latest.holderIdleInTransactionCount === 1
      && latest.lockWaitCount === 1
      && latest.rowWaitSignatureCount === 1
      && latest.waiterRelationIntentLockCount === 1
      && latest.expectedWaitPhaseCount === 1
      && latest.blockedByHolderCount === 1
      && latest.holderPrincipalRelationLockCount === 1
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error(
    `session operation did not reach the Principal lock: ${JSON.stringify(latest)}`,
  )
}

function applicationState(applicationName) {
  return dockerPsql(database, `
    select state
    from pg_catalog.pg_stat_activity
    where datname = ${sqlLiteral(database)}
      and application_name = ${sqlLiteral(applicationName)};
  `)
}

function operationMarkers(applicationName) {
  return {
    backendPidBegin: `BACKEND_PID_BEGIN_${applicationName}`,
    backendPidEnd: `BACKEND_PID_END_${applicationName}`,
    resultBegin: `RESULT_BEGIN_${applicationName}`,
    resultEnd: `RESULT_END_${applicationName}`,
    held: `LOCK_HELD_${applicationName}`,
    committed: `COMMITTED_${applicationName}`,
  }
}

async function startHeldOperation(applicationName, expression) {
  const markers = operationMarkers(applicationName)
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.write(`\\set ON_ERROR_STOP on
begin;
set local statement_timeout = '20s';
set local request.jwt.claims = '{"role":"service_role"}';
\\echo ${markers.backendPidBegin}
select pg_catalog.pg_backend_pid();
\\echo ${markers.backendPidEnd}
\\echo ${markers.resultBegin}
select (${expression})::text;
\\echo ${markers.resultEnd}
\\echo ${markers.held}
  `)
  await waitForSessionOutput(session, markers.held, applicationName)
  return {
    backendPid: parseBackendPid(
      session.stdout,
      markers.backendPidBegin,
      markers.backendPidEnd,
    ),
    markers,
    result: parseMarkedJson(session.stdout, markers.resultBegin, markers.resultEnd),
    session,
  }
}

async function startLockHolder(applicationName, lockSql) {
  const markers = operationMarkers(applicationName)
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.write(`\\set ON_ERROR_STOP on
begin;
set local statement_timeout = '20s';
set local request.jwt.claims = '{"role":"service_role"}';
\\echo ${markers.backendPidBegin}
select pg_catalog.pg_backend_pid();
\\echo ${markers.backendPidEnd}
${lockSql};
\\echo ${markers.held}
  `)
  await waitForSessionOutput(session, markers.held, applicationName)
  return {
    backendPid: parseBackendPid(
      session.stdout,
      markers.backendPidBegin,
      markers.backendPidEnd,
    ),
    markers,
    session,
  }
}

async function releaseHeldSession(held, label) {
  held.session.child.stdin.write(`commit;
\\echo ${held.markers.committed}
`)
  await waitForSessionOutput(held.session, held.markers.committed, label)
  await closePsqlSession(held.session)
}

async function settledValues(settlementsPromise, label) {
  const settlements = await withTimeout(settlementsPromise, label)
  const failures = settlements
    .filter(result => result.status === 'rejected')
    .map(result => result.reason instanceof Error
      ? result.reason.message
      : String(result.reason))
  assert.deepEqual(failures, [])
  return settlements.map(result => result.value)
}

function sessionUseExpression(tokenHash, replacementHash) {
  return `public.use_app_session(
    ${digestSql(tokenHash)},
    ${digestSql(replacementHash)},
    ${uuidSql(randomUUID())}
  )`
}

function createExpression(targetPrincipalId, tokenHash) {
  return `public.create_app_session(
    ${uuidSql(targetPrincipalId)},
    ${digestSql(tokenHash)},
    ${uuidSql(randomUUID())}
  )`
}

function logoutExpression(tokenHash) {
  return `public.logout_app_session(
    ${digestSql(tokenHash)},
    ${uuidSql(randomUUID())}
  )`
}

function revokeExpression(sessionId, actorPrincipalId) {
  return `public.revoke_app_session(
    ${uuidSql(sessionId)},
    ${uuidSql(actorPrincipalId)},
    'administrator',
    ${uuidSql(randomUUID())}
  )`
}

function revokePrincipalExpression(targetPrincipalId, actorPrincipalId) {
  return `public.revoke_principal_sessions(
    ${uuidSql(targetPrincipalId)},
    null::uuid,
    ${uuidSql(actorPrincipalId)},
    'administrator',
    ${uuidSql(randomUUID())}
  )`
}

function revokePrincipalForStatusExpression(targetPrincipalId) {
  return `public.revoke_principal_sessions(
    ${uuidSql(targetPrincipalId)},
    null::uuid,
    null::uuid,
    'principal_status',
    ${uuidSql(randomUUID())}
  )`
}

function consumeLoginExpression(accountFingerprint, networkFingerprint) {
  return `public.consume_login_attempt(
    ${digestSql(accountFingerprint)},
    ${digestSql(networkFingerprint)}
  )`
}

function clearLoginExpression(accountFingerprint) {
  return `public.clear_login_account_throttle(
    ${digestSql(accountFingerprint)}
  )`
}

function cleanupExpression(limit) {
  return `public.cleanup_app_sessions(
    ${limit},
    ${uuidSql(randomUUID())}
  )`
}

let principalId

async function createPrincipal(label) {
  const result = await callJson(
    `public.ensure_principal_identity(
      'cloudbase',
      ${sqlLiteral(`https://session-${label}-${suffix}.example`)},
      ${sqlLiteral(`session-${label}-${suffix}`)}
    )`,
    `principal_${label}_${suffix}`,
  )
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.principalId
}

async function createSession(
  label,
  dueForRotation = false,
  targetPrincipalId = principalId,
) {
  const tokenHash = randomDigest()
  const result = await callJson(
    createExpression(targetPrincipalId, tokenHash),
    `create_${label}_${suffix}`,
  )
  assert.equal(result.ok, true, JSON.stringify(result))

  if (dueForRotation) {
    dockerPsql(database, `
      update app_private.app_session
      set rotate_after = created_at + interval '1 microsecond'
      where id = ${uuidSql(result.sessionId)};
    `)
  }

  return { id: result.sessionId, tokenHash }
}

function setPrincipalStatus(targetPrincipalId, status) {
  if (!['active', 'suspended', 'disabled'].includes(status)) {
    throw new Error('Generated Principal status is unsafe')
  }
  return `update app_private.principal
    set status = ${sqlLiteral(status)}
    where id = ${uuidSql(targetPrincipalId)}`
}

function principalStatus(targetPrincipalId) {
  return dockerPsql(database, `
    select status
    from app_private.principal
    where id = ${uuidSql(targetPrincipalId)};
  `)
}

function seedThrottleRows(rows) {
  for (const row of rows) {
    if (!['account', 'network'].includes(row.scope)) {
      throw new Error('Generated throttle scope is unsafe')
    }
    if (!/^[0-9a-f]{64}$/.test(row.fingerprint)) {
      throw new Error('Generated throttle fingerprint is unsafe')
    }
  }

  const values = rows
    .map(row => `(${sqlLiteral(row.scope)}, ${digestSql(row.fingerprint)})`)
    .join(',\n      ')
  dockerPsql(database, `
    with sampled as (
      select pg_catalog.clock_timestamp() as value
    ), dimensions(scope, fingerprint) as (
      values ${values}
    )
    insert into app_private.login_throttle (
      scope,
      fingerprint,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    )
    select
      dimensions.scope,
      dimensions.fingerprint,
      sampled.value,
      0,
      null,
      sampled.value
    from dimensions cross join sampled;
  `)
}

function backdateThrottleRows(rows) {
  for (const row of rows) {
    if (!['account', 'network'].includes(row.scope)) {
      throw new Error('Generated throttle scope is unsafe')
    }
    if (!/^[0-9a-f]{64}$/.test(row.fingerprint)) {
      throw new Error('Generated throttle fingerprint is unsafe')
    }
  }

  const values = rows
    .map(row => `(${sqlLiteral(row.scope)}, ${digestSql(row.fingerprint)})`)
    .join(',\n      ')
  dockerPsql(database, `
    with sampled as (
      select pg_catalog.clock_timestamp() as value
    ), dimensions(scope, fingerprint) as (
      values ${values}
    )
    update app_private.login_throttle throttle
    set window_started_at = sampled.value - interval '26 hours',
        attempt_count = 0,
        blocked_until = null,
        updated_at = sampled.value - interval '25 hours'
    from sampled, dimensions
    where throttle.scope = dimensions.scope
      and throttle.fingerprint = dimensions.fingerprint;
  `)
}

function throttleCounts(rows) {
  for (const row of rows) {
    if (!/^[a-zA-Z0-9_]+$/.test(row.label)) {
      throw new Error('Generated throttle label is unsafe')
    }
    if (!['account', 'network'].includes(row.scope)) {
      throw new Error('Generated throttle scope is unsafe')
    }
    if (!/^[0-9a-f]{64}$/.test(row.fingerprint)) {
      throw new Error('Generated throttle fingerprint is unsafe')
    }
  }

  const entries = rows.map(row => `${sqlLiteral(row.label)}, (
    select throttle.attempt_count
    from app_private.login_throttle throttle
    where throttle.scope = ${sqlLiteral(row.scope)}
      and throttle.fingerprint = ${digestSql(row.fingerprint)}
  )`).join(',\n      ')
  return JSON.parse(dockerPsql(database, `
    select pg_catalog.jsonb_build_object(
      ${entries}
    )::text;
  `))
}

function throttleWindowMarker(scope, fingerprint) {
  if (!['account', 'network'].includes(scope)) {
    throw new Error('Generated throttle scope is unsafe')
  }
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error('Generated throttle fingerprint is unsafe')
  }

  const marker = dockerPsql(database, `
    select (
      extract(epoch from throttle.window_started_at) * 1000000
    )::numeric(30, 0)::text
    from app_private.login_throttle throttle
    where throttle.scope = ${sqlLiteral(scope)}
      and throttle.fingerprint = ${digestSql(fingerprint)};
  `)
  if (!/^\d+$/.test(marker)) {
    throw new Error('Throttle window marker was missing or unsafe')
  }
  return marker
}

function throttleWindowMarkerChanged(scope, fingerprint, previousMarker) {
  if (!['account', 'network'].includes(scope)) {
    throw new Error('Generated throttle scope is unsafe')
  }
  if (!/^\d+$/.test(previousMarker)) {
    throw new Error('Prior throttle window marker is unsafe')
  }
  return dockerPsql(database, `
    select coalesce((
      select (
        extract(epoch from throttle.window_started_at) * 1000000
      )::numeric(30, 0) <> ${previousMarker}::numeric
      from app_private.login_throttle throttle
      where throttle.scope = ${sqlLiteral(scope)}
        and throttle.fingerprint = ${digestSql(fingerprint)}
    ), false);
  `) === 't'
}

async function sessionSummary(
  sessionId,
  { expectedCurrentHash = null, tokenStates = {} } = {},
) {
  const tokenStateEntries = Object.entries(tokenStates)
  for (const [label, hash] of tokenStateEntries) {
    if (!/^[a-zA-Z0-9_]+$/.test(label)) {
      throw new Error('Generated token-state label is unsafe')
    }
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error('Generated token-state expectation is unsafe')
    }
  }
  if (expectedCurrentHash !== null && !/^[0-9a-f]{64}$/.test(expectedCurrentHash)) {
    throw new Error('Generated current-token expectation is unsafe')
  }

  const currentExpectationSql = expectedCurrentHash === null
    ? 'null::boolean'
    : `exists (
        select 1
        from app_private.app_session_token token
        where token.session_id = session_row.id
          and token.state = 'current'
          and token.token_hash = ${digestSql(expectedCurrentHash)}
      )`
  const tokenStatesSql = tokenStateEntries.length === 0
    ? "'{}'::jsonb"
    : `pg_catalog.jsonb_build_object(
        ${tokenStateEntries.map(([label, hash]) => `${sqlLiteral(label)}, (
          select token.state
          from app_private.app_session_token token
          where token.session_id = session_row.id
            and token.token_hash = ${digestSql(hash)}
        )`).join(',\n        ')}
      )`

  const output = await runPsql(`
    select pg_catalog.jsonb_build_object(
      'revoked', session_row.revoked_at is not null,
      'revokeReason', session_row.revoke_reason,
      'rotationCount', session_row.rotation_count,
      'tokenCount', (
        select count(*) from app_private.app_session_token token
        where token.session_id = session_row.id
      ),
      'currentCount', (
        select count(*) from app_private.app_session_token token
        where token.session_id = session_row.id and token.state = 'current'
      ),
      'graceCount', (
        select count(*) from app_private.app_session_token token
        where token.session_id = session_row.id and token.state = 'grace'
      ),
      'retiredCount', (
        select count(*) from app_private.app_session_token token
        where token.session_id = session_row.id and token.state = 'retired'
      ),
      'currentMatchesExpected', ${currentExpectationSql},
      'tokenStates', ${tokenStatesSql},
      'rotationAuditCount', (
        select count(*) from app_private.audit_event audit
        where audit.action = 'session.rotated'
          and audit.entity_type = 'session'
          and audit.entity_id = session_row.id::text
      ),
      'revokeAuditCount', (
        select count(*) from app_private.audit_event audit
        where audit.action = 'session.revoked'
          and audit.entity_type = 'session'
          and audit.entity_id = session_row.id::text
      )
    )::text
    from app_private.app_session session_row
    where session_row.id = ${uuidSql(sessionId)};
  `, `summary_${suffix}`)
  return JSON.parse(output)
}

function backdateSessionForCleanup(sessionId) {
  dockerPsql(database, `
    with sampled as (select pg_catalog.clock_timestamp() as value)
    update app_private.app_session session_row
    set created_at = sampled.value - interval '34 hours',
        last_seen_at = sampled.value - interval '34 hours',
        idle_expires_at = sampled.value - interval '33 hours 30 minutes',
        absolute_expires_at = sampled.value - interval '26 hours',
        rotate_after = sampled.value - interval '33 hours 45 minutes'
    from sampled
    where session_row.id = ${uuidSql(sessionId)};
  `)
}

function cleanupSummary(sessionIds) {
  const sessionIdList = sessionIds.map(uuidSql).join(', ')
  return JSON.parse(dockerPsql(database, `
    select pg_catalog.jsonb_build_object(
      'existingCount', (
        select count(*)
        from app_private.app_session session_row
        where session_row.id = any(array[${sessionIdList}]::uuid[])
      ),
      'expiredAuditCount', (
        select count(*)
        from app_private.audit_event audit
        where audit.action = 'session.expired'
          and audit.entity_type = 'session'
          and audit.entity_id = any(array[${sessionIdList}]::uuid[]::text[])
      ),
      'distinctExpiredEntityCount', (
        select count(distinct audit.entity_id)
        from app_private.audit_event audit
        where audit.action = 'session.expired'
          and audit.entity_type = 'session'
          and audit.entity_id = any(array[${sessionIdList}]::uuid[]::text[])
      )
    )::text;
  `))
}

function principalSessionCount(targetPrincipalId) {
  return Number(dockerPsql(database, `
    select count(*)
    from app_private.app_session
    where principal_id = ${uuidSql(targetPrincipalId)};
  `))
}

function auditEventCount() {
  return Number(dockerPsql(database, `
    select count(*) from app_private.audit_event;
  `))
}

async function assertOneWaiter(
  applicationName,
  holderApplicationName,
  holderBackendPid,
  holderRelation,
  waiterRelationMode,
) {
  assert.deepEqual(await waitForHolderBlockedWaiters(
    [applicationName],
    holderApplicationName,
    holderBackendPid,
    holderRelation,
    waiterRelationMode,
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 1,
    distinctApplicationCount: 1,
    lockWaitCount: 1,
    rowWaitSignatureCount: 1,
    waiterRelationIntentLockCount: 1,
    expectedWaitPhaseCount: 1,
    blockedByHolderCount: 1,
    holderRelationLockCount: 1,
  })
}

async function testConcurrentRotation() {
  const session = await createSession('rotation_race', true)
  const replacementHashes = [randomDigest(), randomDigest()]
  const holderName = `rotation_holder_${suffix}`
  const waiterNames = [
    `rotation_waiter_a_${suffix}`,
    `rotation_waiter_b_${suffix}`,
  ]
  const holder = await startLockHolder(
    holderName,
    `select id from app_private.app_session
     where id = ${uuidSql(session.id)} for update`,
  )

  const settlementsPromise = Promise.allSettled(
    waiterNames.map((applicationName, index) =>
      callJson(
        sessionUseExpression(session.tokenHash, replacementHashes[index]),
        applicationName,
      )),
  )
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    holder.backendPid,
    'app_private.app_session',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 2,
    distinctApplicationCount: 2,
    lockWaitCount: 2,
    rowWaitSignatureCount: 2,
    waiterRelationIntentLockCount: 2,
    expectedWaitPhaseCount: 2,
    blockedByHolderCount: 2,
    holderRelationLockCount: 1,
  })
  await releaseHeldSession(holder, holderName)

  const results = await settledValues(settlementsPromise, 'concurrent rotation')
  assert.equal(results.filter(result => result.status === 'rotated').length, 1)
  assert.equal(results.filter(result => result.status === 'grace').length, 1)
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results))

  const rotatedIndex = results.findIndex(result => result.status === 'rotated')
  const winningHash = replacementHashes[rotatedIndex]
  const losingHash = replacementHashes[rotatedIndex === 0 ? 1 : 0]
  const summary = await sessionSummary(session.id, {
    expectedCurrentHash: winningHash,
    tokenStates: {
      presented: session.tokenHash,
      losingCandidate: losingHash,
    },
  })
  assert.equal(summary.revoked, false, JSON.stringify(summary))
  assert.equal(summary.rotationCount, 1, JSON.stringify(summary))
  assert.equal(summary.currentCount, 1, JSON.stringify(summary))
  assert.equal(summary.graceCount, 1, JSON.stringify(summary))
  assert.equal(summary.retiredCount, 0, JSON.stringify(summary))
  assert.equal(summary.tokenCount, 2, JSON.stringify(summary))
  assert.equal(summary.currentMatchesExpected, true, JSON.stringify(summary))
  assert.equal(summary.tokenStates.presented, 'grace', JSON.stringify(summary))
  assert.equal(summary.tokenStates.losingCandidate, null, JSON.stringify(summary))
  assert.equal(summary.rotationAuditCount, 1, JSON.stringify(summary))
}

async function testUseThenLogout() {
  const session = await createSession('use_then_logout')
  const holderName = `use_first_${suffix}`
  const logoutName = `logout_second_${suffix}`
  const heldUse = await startHeldOperation(
    holderName,
    sessionUseExpression(session.tokenHash, randomDigest()),
  )
  assert.equal(heldUse.result.ok, true, JSON.stringify(heldUse.result))
  assert.equal(heldUse.result.status, 'active', JSON.stringify(heldUse.result))

  const logoutPromise = callJson(logoutExpression(session.tokenHash), logoutName)
  await assertOneWaiter(
    logoutName,
    holderName,
    heldUse.backendPid,
    'app_private.app_session',
    'RowShareLock',
  )
  await releaseHeldSession(heldUse, holderName)
  const logout = await withTimeout(logoutPromise, 'logout after use')
  assert.equal(logout.revoked, true, JSON.stringify(logout))

  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'logout', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 0, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testLogoutThenUse() {
  const session = await createSession('logout_then_use')
  const holderName = `logout_first_${suffix}`
  const useName = `use_second_${suffix}`
  const heldLogout = await startHeldOperation(
    holderName,
    logoutExpression(session.tokenHash),
  )
  assert.equal(heldLogout.result.revoked, true, JSON.stringify(heldLogout.result))

  const usePromise = callJson(
    sessionUseExpression(session.tokenHash, randomDigest()),
    useName,
  )
  await assertOneWaiter(
    useName,
    holderName,
    heldLogout.backendPid,
    'app_private.app_session',
    'RowShareLock',
  )
  await releaseHeldSession(heldLogout, holderName)
  const use = await withTimeout(usePromise, 'use after logout')
  assert.deepEqual(use, { ok: false })

  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'logout', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 0, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testRotateThenAdminRevoke() {
  const session = await createSession('rotate_then_revoke', true)
  const replacementHash = randomDigest()
  const holderName = `rotate_first_${suffix}`
  const revokeName = `revoke_second_${suffix}`
  const heldRotation = await startHeldOperation(
    holderName,
    sessionUseExpression(session.tokenHash, replacementHash),
  )
  assert.equal(heldRotation.result.status, 'rotated', JSON.stringify(heldRotation.result))

  const revokePromise = callJson(
    revokeExpression(session.id, principalId),
    revokeName,
  )
  await assertOneWaiter(
    revokeName,
    holderName,
    heldRotation.backendPid,
    'app_private.principal',
    'RowShareLock',
  )
  await releaseHeldSession(heldRotation, holderName)
  const revoke = await withTimeout(revokePromise, 'admin revoke after rotation')
  assert.equal(revoke.revoked, true, JSON.stringify(revoke))

  const summary = await sessionSummary(session.id, {
    expectedCurrentHash: replacementHash,
    tokenStates: { presented: session.tokenHash },
  })
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 1, JSON.stringify(summary))
  assert.equal(summary.currentMatchesExpected, true, JSON.stringify(summary))
  assert.equal(summary.tokenStates.presented, 'grace', JSON.stringify(summary))
  assert.equal(summary.rotationAuditCount, 1, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testAdminRevokeThenRotate() {
  const session = await createSession('revoke_then_rotate', true)
  const holderName = `revoke_first_${suffix}`
  const rotateName = `rotate_second_${suffix}`
  const heldRevoke = await startHeldOperation(
    holderName,
    revokeExpression(session.id, principalId),
  )
  assert.equal(heldRevoke.result.revoked, true, JSON.stringify(heldRevoke.result))

  const rotationPromise = callJson(
    sessionUseExpression(session.tokenHash, randomDigest()),
    rotateName,
  )
  await assertOneWaiter(
    rotateName,
    holderName,
    heldRevoke.backendPid,
    'app_private.principal',
    'RowShareLock',
  )
  await releaseHeldSession(heldRevoke, holderName)
  const rotation = await withTimeout(rotationPromise, 'rotation after admin revoke')
  assert.deepEqual(rotation, { ok: false })

  const summary = await sessionSummary(session.id, {
    expectedCurrentHash: session.tokenHash,
  })
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 0, JSON.stringify(summary))
  assert.equal(summary.currentMatchesExpected, true, JSON.stringify(summary))
  assert.equal(summary.graceCount, 0, JSON.stringify(summary))
  assert.equal(summary.rotationAuditCount, 0, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testRotateThenPrincipalRevoke() {
  const targetPrincipalId = await createPrincipal('rotate_then_bulk_target')
  const session = await createSession(
    'rotate_then_bulk',
    true,
    targetPrincipalId,
  )
  const replacementHash = randomDigest()
  const holderName = `rotate_before_bulk_${suffix}`
  const revokeName = `bulk_after_rotate_${suffix}`
  const heldRotation = await startHeldOperation(
    holderName,
    sessionUseExpression(session.tokenHash, replacementHash),
  )
  assert.equal(
    heldRotation.result.status,
    'rotated',
    JSON.stringify(heldRotation.result),
  )

  const revokePromise = callJson(
    revokePrincipalExpression(targetPrincipalId, principalId),
    revokeName,
  )
  assert.deepEqual(
    await waitForPrincipalLockWaiter(
      revokeName,
      holderName,
      heldRotation.backendPid,
    ),
    {
      waiterCount: 1,
      holderIdleInTransactionCount: 1,
      lockWaitCount: 1,
      rowWaitSignatureCount: 1,
      waiterRelationIntentLockCount: 1,
      expectedWaitPhaseCount: 1,
      blockedByHolderCount: 1,
      holderPrincipalRelationLockCount: 1,
    },
  )
  await releaseHeldSession(heldRotation, holderName)
  const revoke = await withTimeout(
    revokePromise,
    'principal-wide revoke after rotation',
  )
  assert.equal(revoke.revoked, 1, JSON.stringify(revoke))

  const summary = await sessionSummary(session.id, {
    expectedCurrentHash: replacementHash,
    tokenStates: { presented: session.tokenHash },
  })
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 1, JSON.stringify(summary))
  assert.equal(summary.currentMatchesExpected, true, JSON.stringify(summary))
  assert.equal(summary.tokenStates.presented, 'grace', JSON.stringify(summary))
  assert.equal(summary.rotationAuditCount, 1, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testPrincipalRevokeThenLogout() {
  const targetPrincipalId = await createPrincipal('bulk_then_logout_target')
  const session = await createSession(
    'bulk_then_logout',
    false,
    targetPrincipalId,
  )
  const holderName = `bulk_before_logout_${suffix}`
  const logoutName = `logout_after_bulk_${suffix}`
  const heldRevoke = await startHeldOperation(
    holderName,
    revokePrincipalExpression(targetPrincipalId, principalId),
  )
  assert.equal(heldRevoke.result.revoked, 1, JSON.stringify(heldRevoke.result))

  const logoutPromise = callJson(logoutExpression(session.tokenHash), logoutName)
  assert.deepEqual(
    await waitForPrincipalLockWaiter(
      logoutName,
      holderName,
      heldRevoke.backendPid,
    ),
    {
      waiterCount: 1,
      holderIdleInTransactionCount: 1,
      lockWaitCount: 1,
      rowWaitSignatureCount: 1,
      waiterRelationIntentLockCount: 1,
      expectedWaitPhaseCount: 1,
      blockedByHolderCount: 1,
      holderPrincipalRelationLockCount: 1,
    },
  )
  await releaseHeldSession(heldRevoke, holderName)
  const logout = await withTimeout(
    logoutPromise,
    'logout after principal-wide revoke',
  )
  assert.deepEqual(logout, { ok: true, revoked: false })

  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.rotationCount, 0, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testActorSuspensionThenAdminRevoke() {
  const actorPrincipalId = await createPrincipal('suspend_before_single_actor')
  const session = await createSession('suspend_before_single_target')
  const holderName = `suspend_before_single_${suffix}`
  const revokeName = `single_after_suspend_${suffix}`
  const heldSuspension = await startLockHolder(
    holderName,
    setPrincipalStatus(actorPrincipalId, 'suspended'),
  )

  const revokePromise = runPsqlExpectSqlState(
    `select ${revokeExpression(session.id, actorPrincipalId)};`,
    revokeName,
    '22023',
  )
  await assertBlockedByHolder(
    revokeName,
    holderName,
    heldSuspension.backendPid,
    'app_private.principal',
    'RowShareLock',
  )
  await releaseHeldSession(heldSuspension, holderName)
  assert.equal(
    await withTimeout(revokePromise, 'single revoke after actor suspension'),
    '22023',
  )

  assert.equal(principalStatus(actorPrincipalId), 'suspended')
  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, false, JSON.stringify(summary))
  assert.equal(summary.revokeReason, null, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 0, JSON.stringify(summary))
}

async function testAdminRevokeThenActorSuspension() {
  const actorPrincipalId = await createPrincipal('single_before_suspend_actor')
  const session = await createSession('single_before_suspend_target')
  const holderName = `single_before_suspend_${suffix}`
  const suspensionName = `suspend_after_single_${suffix}`
  const heldRevoke = await startHeldOperation(
    holderName,
    revokeExpression(session.id, actorPrincipalId),
  )
  assert.equal(heldRevoke.result.revoked, true, JSON.stringify(heldRevoke.result))

  const suspensionPromise = runPsql(
    `${setPrincipalStatus(actorPrincipalId, 'suspended')};`,
    suspensionName,
  )
  await assertBlockedByHolder(
    suspensionName,
    holderName,
    heldRevoke.backendPid,
    'app_private.principal',
    'RowExclusiveLock',
  )
  await releaseHeldSession(heldRevoke, holderName)
  await withTimeout(suspensionPromise, 'actor suspension after single revoke')

  assert.equal(principalStatus(actorPrincipalId), 'suspended')
  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testActorSuspensionThenPrincipalRevoke() {
  const actorPrincipalId = await createPrincipal('suspend_before_bulk_actor')
  const targetPrincipalId = await createPrincipal('suspend_before_bulk_target')
  const session = await createSession(
    'suspend_before_bulk',
    false,
    targetPrincipalId,
  )
  const holderName = `suspend_before_bulk_${suffix}`
  const revokeName = `bulk_after_suspend_${suffix}`
  const heldSuspension = await startLockHolder(
    holderName,
    setPrincipalStatus(actorPrincipalId, 'suspended'),
  )

  const revokePromise = runPsqlExpectSqlState(
    `select ${revokePrincipalExpression(targetPrincipalId, actorPrincipalId)};`,
    revokeName,
    '22023',
  )
  await assertBlockedByHolder(
    revokeName,
    holderName,
    heldSuspension.backendPid,
    'app_private.principal',
    'RowShareLock',
  )
  await releaseHeldSession(heldSuspension, holderName)
  assert.equal(
    await withTimeout(revokePromise, 'principal revoke after actor suspension'),
    '22023',
  )

  assert.equal(principalStatus(actorPrincipalId), 'suspended')
  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, false, JSON.stringify(summary))
  assert.equal(summary.revokeReason, null, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 0, JSON.stringify(summary))
}

async function testPrincipalRevokeThenActorSuspension() {
  const actorPrincipalId = await createPrincipal('bulk_before_suspend_actor')
  const targetPrincipalId = await createPrincipal('bulk_before_suspend_target')
  const session = await createSession(
    'bulk_before_suspend',
    false,
    targetPrincipalId,
  )
  const holderName = `bulk_before_suspend_${suffix}`
  const suspensionName = `suspend_after_bulk_${suffix}`
  const heldRevoke = await startHeldOperation(
    holderName,
    revokePrincipalExpression(targetPrincipalId, actorPrincipalId),
  )
  assert.equal(heldRevoke.result.revoked, 1, JSON.stringify(heldRevoke.result))

  const suspensionPromise = runPsql(
    `${setPrincipalStatus(actorPrincipalId, 'suspended')};`,
    suspensionName,
  )
  await assertBlockedByHolder(
    suspensionName,
    holderName,
    heldRevoke.backendPid,
    'app_private.principal',
    'RowExclusiveLock',
  )
  await releaseHeldSession(heldRevoke, holderName)
  await withTimeout(suspensionPromise, 'actor suspension after principal revoke')

  assert.equal(principalStatus(actorPrincipalId), 'suspended')
  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testConcurrentDuplicateLogout() {
  const session = await createSession('duplicate_logout')
  const holderName = `logout_holder_${suffix}`
  const waiterNames = Array.from(
    { length: 8 },
    (_, index) => `logout_waiter_${suffix}_${index}`,
  )
  const holder = await startLockHolder(
    holderName,
    `select id from app_private.app_session
     where id = ${uuidSql(session.id)} for update`,
  )
  const settlementsPromise = Promise.allSettled(
    waiterNames.map(applicationName =>
      callJson(logoutExpression(session.tokenHash), applicationName)),
  )
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    holder.backendPid,
    'app_private.app_session',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 8,
    distinctApplicationCount: 8,
    lockWaitCount: 8,
    rowWaitSignatureCount: 8,
    waiterRelationIntentLockCount: 8,
    expectedWaitPhaseCount: 8,
    blockedByHolderCount: 8,
    holderRelationLockCount: 1,
  })
  await releaseHeldSession(holder, holderName)

  const results = await settledValues(
    settlementsPromise,
    'concurrent duplicate logout',
  )
  assert.equal(results.filter(result => result.revoked === true).length, 1)
  assert.equal(results.filter(result => result.revoked === false).length, 7)
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results))

  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'logout', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testConcurrentDuplicateSingleRevoke() {
  const session = await createSession('duplicate_single_revoke')
  const holderName = `single_revoke_holder_${suffix}`
  const waiterNames = Array.from(
    { length: 6 },
    (_, index) => `single_revoke_waiter_${suffix}_${index}`,
  )
  const heldRevoke = await startHeldOperation(
    holderName,
    revokeExpression(session.id, principalId),
  )
  assert.equal(heldRevoke.result.revoked, true, JSON.stringify(heldRevoke.result))

  const settlementsPromise = Promise.allSettled(
    waiterNames.map(applicationName =>
      callJson(revokeExpression(session.id, principalId), applicationName)),
  )
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    heldRevoke.backendPid,
    'app_private.principal',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 6,
    distinctApplicationCount: 6,
    lockWaitCount: 6,
    rowWaitSignatureCount: 6,
    waiterRelationIntentLockCount: 6,
    expectedWaitPhaseCount: 6,
    blockedByHolderCount: 6,
    holderRelationLockCount: 1,
  })
  await releaseHeldSession(heldRevoke, holderName)

  const results = await settledValues(
    settlementsPromise,
    'concurrent duplicate single-session revoke',
  )
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results))
  assert.ok(
    results.every(result => result.revoked === false),
    JSON.stringify(results),
  )

  const summary = await sessionSummary(session.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testConcurrentDuplicatePrincipalRevoke() {
  const targetPrincipalId = await createPrincipal('duplicate_bulk_revoke_target')
  const sessions = await Promise.all([
    createSession('duplicate_bulk_revoke_a', false, targetPrincipalId),
    createSession('duplicate_bulk_revoke_b', false, targetPrincipalId),
  ])
  const holderName = `bulk_revoke_holder_${suffix}`
  const waiterNames = Array.from(
    { length: 6 },
    (_, index) => `bulk_revoke_waiter_${suffix}_${index}`,
  )
  const heldRevoke = await startHeldOperation(
    holderName,
    revokePrincipalExpression(targetPrincipalId, principalId),
  )
  assert.equal(heldRevoke.result.revoked, 2, JSON.stringify(heldRevoke.result))

  const settlementsPromise = Promise.allSettled(
    waiterNames.map(applicationName =>
      callJson(
        revokePrincipalExpression(targetPrincipalId, principalId),
        applicationName,
      )),
  )
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    heldRevoke.backendPid,
    'app_private.principal',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 6,
    distinctApplicationCount: 6,
    lockWaitCount: 6,
    rowWaitSignatureCount: 6,
    waiterRelationIntentLockCount: 6,
    expectedWaitPhaseCount: 6,
    blockedByHolderCount: 6,
    holderRelationLockCount: 1,
  })
  await releaseHeldSession(heldRevoke, holderName)

  const results = await settledValues(
    settlementsPromise,
    'concurrent duplicate principal-wide revoke',
  )
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results))
  assert.ok(
    results.every(result => result.revoked === 0),
    JSON.stringify(results),
  )

  for (const session of sessions) {
    const summary = await sessionSummary(session.id)
    assert.equal(summary.revoked, true, JSON.stringify(summary))
    assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
    assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
  }
}

async function testConcurrentLoginThrottle() {
  const fingerprint = randomDigest()
  dockerPsql(database, `
    with sampled as (select pg_catalog.clock_timestamp() as value)
    insert into app_private.login_throttle (
      scope,
      fingerprint,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    )
    select scope.value, ${digestSql(fingerprint)}, sampled.value, 0, null, sampled.value
    from sampled
    cross join (values ('account'), ('network')) as scope(value);
  `)

  const holderName = `throttle_holder_${suffix}`
  const waiterNames = Array.from(
    { length: 12 },
    (_, index) => `throttle_waiter_${suffix}_${index}`,
  )
  const holder = await startLockHolder(
    holderName,
    `select 1 from app_private.login_throttle
     where scope = 'account' and fingerprint = ${digestSql(fingerprint)}
     for update`,
  )
  const settlementsPromise = Promise.allSettled(
    waiterNames.map(applicationName =>
      callJson(
        `public.consume_login_attempt(
          ${digestSql(fingerprint)},
          ${digestSql(fingerprint)}
        )`,
        applicationName,
      )),
  )
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    holder.backendPid,
    'app_private.login_throttle',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 12,
    distinctApplicationCount: 12,
    lockWaitCount: 12,
    rowWaitSignatureCount: 12,
    waiterRelationIntentLockCount: 12,
    expectedWaitPhaseCount: 12,
    blockedByHolderCount: 12,
    holderRelationLockCount: 1,
  })
  await releaseHeldSession(holder, holderName)

  const results = await settledValues(
    settlementsPromise,
    'concurrent login throttle',
  )
  assert.ok(results.every(result => result.ok === true), JSON.stringify(results))
  assert.equal(results.filter(result => result.allowed === true).length, 5)
  assert.equal(results.filter(result => result.allowed === false).length, 7)
  assert.ok(
    results
      .filter(result => result.allowed === false)
      .every(result => result.retryAfterSeconds > 0),
    JSON.stringify(results),
  )

  const summary = JSON.parse(dockerPsql(database, `
    select pg_catalog.jsonb_build_object(
      'accountAttemptCount', max(attempt_count) filter (where scope = 'account'),
      'accountBlocked', bool_or(blocked_until is not null) filter (
        where scope = 'account'
      ),
      'networkAttemptCount', max(attempt_count) filter (where scope = 'network'),
      'networkBlocked', bool_or(blocked_until is not null) filter (
        where scope = 'network'
      )
    )::text
    from app_private.login_throttle
    where fingerprint = ${digestSql(fingerprint)};
  `))
  assert.deepEqual(summary, {
    accountAttemptCount: 6,
    accountBlocked: true,
    networkAttemptCount: 12,
    networkBlocked: false,
  })
}

async function testConsumeThenClearLoginThrottle() {
  const accountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  seedThrottleRows([
    { scope: 'account', fingerprint: accountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ])

  const holderName = `consume_before_clear_${suffix}`
  const clearName = `clear_after_consume_${suffix}`
  const heldConsume = await startHeldOperation(
    holderName,
    consumeLoginExpression(accountFingerprint, networkFingerprint),
  )
  assert.equal(heldConsume.result.allowed, true, JSON.stringify(heldConsume.result))

  const clearPromise = callJson(
    clearLoginExpression(accountFingerprint),
    clearName,
  )
  await assertBlockedByHolder(
    clearName,
    holderName,
    heldConsume.backendPid,
    'app_private.login_throttle',
    'RowExclusiveLock',
  )
  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 0, network: 0 },
  )
  await releaseHeldSession(heldConsume, holderName)
  const cleared = await withTimeout(clearPromise, 'clear after login consume')
  assert.deepEqual(cleared, { ok: true, cleared: true })

  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: null, network: 1 },
  )
}

async function testClearThenConsumeLoginThrottle() {
  const accountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  seedThrottleRows([
    { scope: 'account', fingerprint: accountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ])

  const holderName = `clear_before_consume_${suffix}`
  const consumeName = `consume_after_clear_${suffix}`
  const heldClear = await startHeldOperation(
    holderName,
    clearLoginExpression(accountFingerprint),
  )
  assert.deepEqual(heldClear.result, { ok: true, cleared: true })

  const consumePromise = callJson(
    consumeLoginExpression(accountFingerprint, networkFingerprint),
    consumeName,
  )
  await assertBlockedByHolder(
    consumeName,
    holderName,
    heldClear.backendPid,
    'app_private.login_throttle',
    'RowExclusiveLock',
  )
  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 0, network: 0 },
  )
  await releaseHeldSession(heldClear, holderName)
  const consumed = await withTimeout(consumePromise, 'login consume after clear')
  assert.equal(consumed.allowed, true, JSON.stringify(consumed))

  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 1, network: 1 },
  )
}

async function testConflictThenDeleteBeforeThrottleRowLock() {
  const accountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  seedThrottleRows([
    { scope: 'account', fingerprint: accountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ])
  const originalWindowMarker = throttleWindowMarker(
    'account',
    accountFingerprint,
  )
  const auditCountBefore = auditEventCount()

  const holderName = `throttle_gap_holder_${suffix}`
  const deleterName = `throttle_gap_deleter_${suffix}`
  const consumerName = `throttle_gap_consumer_${suffix}`
  const holder = await startLockHolder(
    holderName,
    `select 1 from app_private.login_throttle
     where scope = 'account'
       and fingerprint = ${digestSql(accountFingerprint)}
     for share`,
  )

  // Queue DELETE first. The holder's row-share lock lets an already committed
  // uniqueness conflict be observed, but it blocks both DELETE and the later
  // SELECT ... FOR UPDATE used by the throttle helper.
  const heldDeletePromise = startHeldOperation(
    deleterName,
    clearLoginExpression(accountFingerprint),
  )
  await assertBlockedByHolder(
    deleterName,
    holderName,
    holder.backendPid,
    'app_private.login_throttle',
    'RowExclusiveLock',
  )

  const consumePromise = callJson(
    consumeLoginExpression(accountFingerprint, networkFingerprint),
    consumerName,
  )
  assert.deepEqual(
    await waitForThrottleDeletionGap(
      consumerName,
      deleterName,
      holderName,
      holder.backendPid,
    ),
    {
      consumerCount: 1,
      deleterCount: 1,
      holderCount: 1,
      holderIdleInTransactionCount: 1,
      consumerLockWaitCount: 1,
      deleterLockWaitCount: 1,
      consumerRowWaitSignatureCount: 1,
      deleterRowWaitSignatureCount: 1,
      deleterBlockedByHolderCount: 1,
      consumerBlockedByDeleterCount: 1,
      holderRowShareLockCount: 1,
      deleterRowExclusiveLockCount: 1,
      consumerRowExclusiveLockCount: 1,
      consumerRowShareLockCount: 1,
    },
  )

  await releaseHeldSession(holder, holderName)
  const heldDelete = await withTimeout(
    heldDeletePromise,
    'account delete after the conflict-to-lock barrier',
  )
  assert.deepEqual(heldDelete.result, { ok: true, cleared: true })
  assert.equal(applicationState(deleterName), 'idle in transaction')

  // DELETE has completed but is deliberately uncommitted. The consumer is now
  // directly blocked by that deleting transaction, proving the queue order.
  await assertBlockedByHolder(
    consumerName,
    deleterName,
    heldDelete.backendPid,
    'app_private.login_throttle',
    'RowShareLock',
  )
  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 0, network: 0 },
  )

  await releaseHeldSession(heldDelete, deleterName)
  const consumed = await withTimeout(
    consumePromise,
    'login consume after the conflict-to-lock row was deleted',
  )
  assert.deepEqual(consumed, {
    ok: true,
    allowed: true,
    retryAfterSeconds: 0,
  })
  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 1, network: 1 },
  )
  assert.equal(
    throttleWindowMarkerChanged(
      'account',
      accountFingerprint,
      originalWindowMarker,
    ),
    true,
  )
  assert.equal(auditEventCount(), auditCountBefore)
}

async function testCleanupThenConsumeLoginThrottle() {
  const accountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  const dimensions = [
    { scope: 'account', fingerprint: accountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ]
  seedThrottleRows(dimensions)
  backdateThrottleRows(dimensions)
  const auditCountBefore = auditEventCount()

  const holderName = `cleanup_before_consume_${suffix}`
  const consumeName = `consume_after_cleanup_${suffix}`
  const heldCleanup = await startHeldOperation(
    holderName,
    cleanupExpression(2),
  )
  assert.equal(
    heldCleanup.result.throttlesDeleted,
    2,
    JSON.stringify(heldCleanup.result),
  )
  assert.equal(
    heldCleanup.result.sessionsDeleted,
    0,
    JSON.stringify(heldCleanup.result),
  )

  const consumePromise = callJson(
    consumeLoginExpression(accountFingerprint, networkFingerprint),
    consumeName,
  )
  await assertBlockedByHolder(
    consumeName,
    holderName,
    heldCleanup.backendPid,
    'app_private.login_throttle',
    'RowExclusiveLock',
  )
  await releaseHeldSession(heldCleanup, holderName)
  const consumed = await withTimeout(
    consumePromise,
    'login consume after throttle cleanup',
  )
  assert.deepEqual(consumed, {
    ok: true,
    allowed: true,
    retryAfterSeconds: 0,
  })

  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 1, network: 1 },
  )
  assert.equal(auditEventCount(), auditCountBefore)
}

async function testConsumeThenCleanupLoginThrottle() {
  const accountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  const dimensions = [
    { scope: 'account', fingerprint: accountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ]
  seedThrottleRows(dimensions)
  backdateThrottleRows(dimensions)
  const auditCountBefore = auditEventCount()

  const holderName = `consume_before_cleanup_${suffix}`
  const cleanupName = `cleanup_after_consume_${suffix}`
  const heldConsume = await startHeldOperation(
    holderName,
    consumeLoginExpression(accountFingerprint, networkFingerprint),
  )
  assert.deepEqual(heldConsume.result, {
    ok: true,
    allowed: true,
    retryAfterSeconds: 0,
  })
  assert.equal(applicationState(holderName), 'idle in transaction')

  const cleanupResult = await withTimeout(
    callJson(cleanupExpression(2), cleanupName),
    'throttle cleanup while login consume owns both dimensions',
    5_000,
  )
  assert.equal(
    cleanupResult.throttlesDeleted,
    0,
    JSON.stringify(cleanupResult),
  )
  assert.equal(
    cleanupResult.sessionsDeleted,
    0,
    JSON.stringify(cleanupResult),
  )
  assert.equal(applicationState(holderName), 'idle in transaction')

  await releaseHeldSession(heldConsume, holderName)
  assert.deepEqual(
    throttleCounts([
      {
        label: 'account',
        scope: 'account',
        fingerprint: accountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { account: 1, network: 1 },
  )
  assert.equal(auditEventCount(), auditCountBefore)
}

async function testDistinctAccountsWithSharedNetwork() {
  const firstAccountFingerprint = randomDigest()
  const secondAccountFingerprint = randomDigest()
  const networkFingerprint = randomDigest()
  seedThrottleRows([
    { scope: 'account', fingerprint: firstAccountFingerprint },
    { scope: 'account', fingerprint: secondAccountFingerprint },
    { scope: 'network', fingerprint: networkFingerprint },
  ])

  const holderName = `shared_network_holder_${suffix}`
  const waiterNames = [
    `shared_network_first_${suffix}`,
    `shared_network_second_${suffix}`,
  ]
  const holder = await startLockHolder(
    holderName,
    `select 1 from app_private.login_throttle
     where scope = 'network'
       and fingerprint = ${digestSql(networkFingerprint)}
     for update`,
  )
  const settlementsPromise = Promise.allSettled([
    callJson(
      consumeLoginExpression(firstAccountFingerprint, networkFingerprint),
      waiterNames[0],
    ),
    callJson(
      consumeLoginExpression(secondAccountFingerprint, networkFingerprint),
      waiterNames[1],
    ),
  ])
  assert.deepEqual(await waitForHolderBlockedWaiters(
    waiterNames,
    holderName,
    holder.backendPid,
    'app_private.login_throttle',
    'RowShareLock',
  ), {
    holderCount: 1,
    holderIdleInTransactionCount: 1,
    sessionCount: 2,
    distinctApplicationCount: 2,
    lockWaitCount: 2,
    rowWaitSignatureCount: 2,
    waiterRelationIntentLockCount: 2,
    expectedWaitPhaseCount: 2,
    blockedByHolderCount: 2,
    holderRelationLockCount: 1,
  })
  assert.deepEqual(
    throttleCounts([
      {
        label: 'firstAccount',
        scope: 'account',
        fingerprint: firstAccountFingerprint,
      },
      {
        label: 'secondAccount',
        scope: 'account',
        fingerprint: secondAccountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { firstAccount: 0, secondAccount: 0, network: 0 },
  )
  await releaseHeldSession(holder, holderName)

  const results = await settledValues(
    settlementsPromise,
    'distinct-account shared-network login attempts',
  )
  assert.ok(results.every(result => result.allowed === true), JSON.stringify(results))
  assert.deepEqual(
    throttleCounts([
      {
        label: 'firstAccount',
        scope: 'account',
        fingerprint: firstAccountFingerprint,
      },
      {
        label: 'secondAccount',
        scope: 'account',
        fingerprint: secondAccountFingerprint,
      },
      {
        label: 'network',
        scope: 'network',
        fingerprint: networkFingerprint,
      },
    ]),
    { firstAccount: 1, secondAccount: 1, network: 2 },
  )
}

async function testCreateThenPrincipalRevoke() {
  const targetPrincipalId = await createPrincipal('create_then_bulk')
  const tokenHash = randomDigest()
  const holderName = `create_before_bulk_${suffix}`
  const revokeName = `bulk_after_create_${suffix}`
  const heldCreate = await startHeldOperation(
    holderName,
    createExpression(targetPrincipalId, tokenHash),
  )
  assert.equal(heldCreate.result.ok, true, JSON.stringify(heldCreate.result))

  const revokePromise = callJson(
    revokePrincipalExpression(targetPrincipalId, principalId),
    revokeName,
  )
  assert.deepEqual(
    await waitForPrincipalLockWaiter(
      revokeName,
      holderName,
      heldCreate.backendPid,
    ),
    {
      waiterCount: 1,
      holderIdleInTransactionCount: 1,
      lockWaitCount: 1,
      rowWaitSignatureCount: 1,
      waiterRelationIntentLockCount: 1,
      expectedWaitPhaseCount: 1,
      blockedByHolderCount: 1,
      holderPrincipalRelationLockCount: 1,
    },
  )
  await releaseHeldSession(heldCreate, holderName)
  const revoke = await withTimeout(
    revokePromise,
    'principal revoke after session creation',
  )
  assert.equal(revoke.revoked, 1, JSON.stringify(revoke))

  const summary = await sessionSummary(heldCreate.result.sessionId)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'administrator', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testPrincipalRevokeThenCreate() {
  const targetPrincipalId = await createPrincipal('bulk_then_create')
  const tokenHash = randomDigest()
  const holderName = `bulk_before_create_${suffix}`
  const createName = `create_after_bulk_${suffix}`
  const heldRevoke = await startHeldOperation(
    holderName,
    revokePrincipalExpression(targetPrincipalId, principalId),
  )
  assert.equal(heldRevoke.result.revoked, 0, JSON.stringify(heldRevoke.result))

  const createPromise = callJson(
    createExpression(targetPrincipalId, tokenHash),
    createName,
  )
  assert.deepEqual(
    await waitForPrincipalLockWaiter(
      createName,
      holderName,
      heldRevoke.backendPid,
    ),
    {
      waiterCount: 1,
      holderIdleInTransactionCount: 1,
      lockWaitCount: 1,
      rowWaitSignatureCount: 1,
      waiterRelationIntentLockCount: 1,
      expectedWaitPhaseCount: 1,
      blockedByHolderCount: 1,
      holderPrincipalRelationLockCount: 1,
    },
  )
  await releaseHeldSession(heldRevoke, holderName)
  const created = await withTimeout(
    createPromise,
    'session creation after principal revoke',
  )
  assert.equal(created.ok, true, JSON.stringify(created))

  const summary = await sessionSummary(created.sessionId, {
    expectedCurrentHash: tokenHash,
  })
  assert.equal(summary.revoked, false, JSON.stringify(summary))
  assert.equal(summary.revokeReason, null, JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 0, JSON.stringify(summary))
  assert.equal(summary.currentMatchesExpected, true, JSON.stringify(summary))
}

async function testCreateThenPrincipalStatusWriter() {
  const targetPrincipalId = await createPrincipal('create_then_status_writer')
  const tokenHash = randomDigest()
  const holderName = `create_before_status_${suffix}`
  const writerName = `status_after_create_${suffix}`
  const heldCreate = await startHeldOperation(
    holderName,
    createExpression(targetPrincipalId, tokenHash),
  )
  assert.equal(heldCreate.result.ok, true, JSON.stringify(heldCreate.result))

  const writerPromise = runPsql(`
    begin;
    ${setPrincipalStatus(targetPrincipalId, 'suspended')};
    select (${revokePrincipalForStatusExpression(targetPrincipalId)})::text;
    commit;
  `, writerName)
  await assertBlockedByHolder(
    writerName,
    holderName,
    heldCreate.backendPid,
    'app_private.principal',
    'RowExclusiveLock',
  )
  await releaseHeldSession(heldCreate, holderName)
  const writerResult = JSON.parse(
    await withTimeout(writerPromise, 'status writer after session creation'),
  )
  assert.deepEqual(writerResult, { ok: true, revoked: 1 })

  assert.equal(principalStatus(targetPrincipalId), 'suspended')
  assert.equal(principalSessionCount(targetPrincipalId), 1)
  const summary = await sessionSummary(heldCreate.result.sessionId)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'principal_status', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testPrincipalStatusWriterThenCreate() {
  const targetPrincipalId = await createPrincipal('status_writer_then_create')
  const existingSession = await createSession(
    'status_writer_existing_family',
    false,
    targetPrincipalId,
  )
  const attemptedTokenHash = randomDigest()
  const holderName = `status_before_create_${suffix}`
  const createName = `create_after_status_${suffix}`
  const heldWriter = await startLockHolder(
    holderName,
    `${setPrincipalStatus(targetPrincipalId, 'suspended')};
     select (${revokePrincipalForStatusExpression(targetPrincipalId)})::text`,
  )

  const createPromise = runPsqlExpectSqlState(
    `select ${createExpression(targetPrincipalId, attemptedTokenHash)};`,
    createName,
    '55000',
  )
  await assertBlockedByHolder(
    createName,
    holderName,
    heldWriter.backendPid,
    'app_private.principal',
    'RowShareLock',
  )
  await releaseHeldSession(heldWriter, holderName)
  assert.equal(
    await withTimeout(createPromise, 'session creation after status writer'),
    '55000',
  )

  assert.equal(principalStatus(targetPrincipalId), 'suspended')
  assert.equal(principalSessionCount(targetPrincipalId), 1)
  const summary = await sessionSummary(existingSession.id)
  assert.equal(summary.revoked, true, JSON.stringify(summary))
  assert.equal(summary.revokeReason, 'principal_status', JSON.stringify(summary))
  assert.equal(summary.revokeAuditCount, 1, JSON.stringify(summary))
}

async function testConcurrentCleanupWorkers() {
  const firstSession = await createSession('cleanup_worker_a')
  const secondSession = await createSession('cleanup_worker_b')
  backdateSessionForCleanup(firstSession.id)
  backdateSessionForCleanup(secondSession.id)

  const firstWorkerName = `cleanup_worker_a_${suffix}`
  const secondWorkerName = `cleanup_worker_b_${suffix}`
  const heldCleanup = await startHeldOperation(
    firstWorkerName,
    cleanupExpression(1),
  )
  assert.equal(
    heldCleanup.result.sessionsDeleted,
    1,
    JSON.stringify(heldCleanup.result),
  )
  assert.equal(applicationState(firstWorkerName), 'idle in transaction')

  // Worker B must finish while worker A still owns its deleted family. If the
  // candidate query waited instead of using SKIP LOCKED, this timeout would
  // fire because worker A is deliberately not committed yet.
  const secondResult = await withTimeout(
    callJson(cleanupExpression(1), secondWorkerName),
    'second cleanup worker while first holds a family',
    5_000,
  )
  assert.equal(secondResult.sessionsDeleted, 1, JSON.stringify(secondResult))
  assert.equal(applicationState(firstWorkerName), 'idle in transaction')

  await releaseHeldSession(heldCleanup, firstWorkerName)
  assert.deepEqual(
    cleanupSummary([firstSession.id, secondSession.id]),
    {
      existingCount: 0,
      expiredAuditCount: 2,
      distinctExpiredEntityCount: 2,
    },
  )
}

async function testConcurrentThrottleCleanupWorkers() {
  const dimensions = [
    { scope: 'account', fingerprint: randomDigest() },
    { scope: 'account', fingerprint: randomDigest() },
  ]
  seedThrottleRows(dimensions)
  backdateThrottleRows(dimensions)
  const auditCountBefore = auditEventCount()

  const firstWorkerName = `throttle_cleanup_a_${suffix}`
  const secondWorkerName = `throttle_cleanup_b_${suffix}`
  const heldCleanup = await startHeldOperation(
    firstWorkerName,
    cleanupExpression(1),
  )
  assert.equal(
    heldCleanup.result.throttlesDeleted,
    1,
    JSON.stringify(heldCleanup.result),
  )
  assert.equal(
    heldCleanup.result.sessionsDeleted,
    0,
    JSON.stringify(heldCleanup.result),
  )
  assert.equal(applicationState(firstWorkerName), 'idle in transaction')

  const secondResult = await withTimeout(
    callJson(cleanupExpression(1), secondWorkerName),
    'second cleanup worker while first holds a throttle row',
    5_000,
  )
  assert.equal(secondResult.throttlesDeleted, 1, JSON.stringify(secondResult))
  assert.equal(secondResult.sessionsDeleted, 0, JSON.stringify(secondResult))
  assert.equal(applicationState(firstWorkerName), 'idle in transaction')

  const inFlightCounts = throttleCounts(dimensions.map((dimension, index) => ({
    ...dimension,
    label: `worker${index}`,
  })))
  assert.equal(
    Object.values(inFlightCounts).filter(value => value !== null).length,
    1,
    JSON.stringify(inFlightCounts),
  )

  await releaseHeldSession(heldCleanup, firstWorkerName)
  assert.deepEqual(
    throttleCounts(dimensions.map((dimension, index) => ({
      ...dimension,
      label: `worker${index}`,
    }))),
    { worker0: null, worker1: null },
  )
  assert.equal(auditEventCount(), auditCountBefore)
}

async function testCleanupSkipsLiveFamilyOperation() {
  const heldSession = await createSession('cleanup_live_family')
  const deletableSession = await createSession('cleanup_other_family')
  backdateSessionForCleanup(heldSession.id)
  backdateSessionForCleanup(deletableSession.id)

  const holderName = `cleanup_live_holder_${suffix}`
  const cleanupName = `cleanup_live_worker_${suffix}`
  const heldUse = await startHeldOperation(
    holderName,
    sessionUseExpression(heldSession.tokenHash, randomDigest()),
  )
  assert.deepEqual(heldUse.result, { ok: false })
  assert.equal(applicationState(holderName), 'idle in transaction')

  const firstCleanup = await withTimeout(
    callJson(cleanupExpression(1), cleanupName),
    'cleanup while a late family use owns another candidate',
    5_000,
  )
  assert.equal(firstCleanup.sessionsDeleted, 1, JSON.stringify(firstCleanup))
  assert.equal(applicationState(holderName), 'idle in transaction')
  assert.deepEqual(cleanupSummary([heldSession.id]), {
    existingCount: 1,
    expiredAuditCount: 0,
    distinctExpiredEntityCount: 0,
  })
  assert.deepEqual(cleanupSummary([deletableSession.id]), {
    existingCount: 0,
    expiredAuditCount: 1,
    distinctExpiredEntityCount: 1,
  })

  await releaseHeldSession(heldUse, holderName)
  const converged = await callJson(
    cleanupExpression(1),
    `cleanup_live_converge_${suffix}`,
  )
  assert.equal(converged.sessionsDeleted, 1, JSON.stringify(converged))
  assert.deepEqual(cleanupSummary([heldSession.id, deletableSession.id]), {
    existingCount: 0,
    expiredAuditCount: 2,
    distinctExpiredEntityCount: 2,
  })
}

let databaseCreated = false
let primaryError = null
let cleanupError = null

try {
  dockerPsql('postgres', `create database ${database};`)
  databaseCreated = true
  runMigration()

  const identity = await callJson(
    `public.ensure_principal_identity(
      'cloudbase',
      ${sqlLiteral(`https://session-concurrency-${suffix}.example`)},
      ${sqlLiteral(`session-subject-${suffix}`)}
    )`,
    `principal_${suffix}`,
  )
  assert.equal(identity.ok, true, JSON.stringify(identity))
  principalId = identity.principalId

  await testConcurrentRotation()
  await testUseThenLogout()
  await testLogoutThenUse()
  await testRotateThenAdminRevoke()
  await testAdminRevokeThenRotate()
  await testRotateThenPrincipalRevoke()
  await testPrincipalRevokeThenLogout()
  await testActorSuspensionThenAdminRevoke()
  await testAdminRevokeThenActorSuspension()
  await testActorSuspensionThenPrincipalRevoke()
  await testPrincipalRevokeThenActorSuspension()
  await testConcurrentDuplicateLogout()
  await testConcurrentDuplicateSingleRevoke()
  await testConcurrentDuplicatePrincipalRevoke()
  await testConcurrentLoginThrottle()
  await testConsumeThenClearLoginThrottle()
  await testClearThenConsumeLoginThrottle()
  await testConflictThenDeleteBeforeThrottleRowLock()
  await testCleanupThenConsumeLoginThrottle()
  await testConsumeThenCleanupLoginThrottle()
  await testDistinctAccountsWithSharedNetwork()
  await testCreateThenPrincipalRevoke()
  await testPrincipalRevokeThenCreate()
  await testCreateThenPrincipalStatusWriter()
  await testPrincipalStatusWriterThenCreate()
  await testConcurrentCleanupWorkers()
  await testConcurrentThrottleCleanupWorkers()
  await testCleanupSkipsLiveFamilyOperation()

  console.log('session concurrency, throttle, and cleanup tests passed')
} catch (error) {
  primaryError = error
} finally {
  const cleanupErrors = []
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
          'Session test database cleanup failed twice',
        ),
      )
    }
  }

  if (cleanupErrors.length === 1) cleanupError = cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    cleanupError = new AggregateError(cleanupErrors, 'Session test cleanup failed')
  }
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    'Session concurrency test and cleanup failed',
  )
}
if (primaryError) throw primaryError
if (cleanupError) throw cleanupError
