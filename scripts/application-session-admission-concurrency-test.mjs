import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`
const database = `cs2cup_admission_${suffix}`
const PROCESS_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 100
const activePsqlSessions = new Set()

if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('Generated application-session admission database name is unsafe')
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function parseJsonSafely(value, failureMessage) {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(failureMessage)
  }
}

function assertSafeDeepEqual(actual, expected, failureMessage) {
  assert.ok(isDeepStrictEqual(actual, expected), failureMessage)
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
    throw new Error('application-session admission psql command failed')
  }
  return result.stdout.trim()
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
    if (session.error) {
      throw new Error(`${label} process failed`)
    }
    if (session.exited) {
      throw new Error(`${label} exited before the expected marker`)
    }
    if (Date.now() >= deadline) {
      throw new Error(`${label} timed out before the expected marker`)
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
    throw new Error('Application-session admission migration failed')
  }
}

async function runPsql(sql, applicationName) {
  const session = startPsqlSession(database, applicationName)
  session.child.stdin.end(`set request.jwt.claims = '{"role":"service_role"}';\n${sql}`)
  await withTimeout(session.exit, `psql ${applicationName ?? 'query'}`)
  if (session.error) throw new Error('application-session admission psql process failed')
  if (session.exitCode !== 0) {
    throw new Error('application-session admission psql query failed')
  }
  return session.stdout.trim()
}

async function admit({ subject, issuer, tokenLabel, requestId, applicationName }) {
  const output = await runPsql(`
    select public.admit_admin_app_session(
      'cloudbase',
      ${sqlLiteral(issuer)},
      ${sqlLiteral(subject)},
      pg_catalog.sha256(pg_catalog.convert_to(${sqlLiteral(tokenLabel)}, 'UTF8')),
      ${sqlLiteral(requestId)}::uuid
    )::text;
  `, applicationName)
  return {
    applicationName,
    requestId,
    tokenLabel,
    payload: parseJsonSafely(output, 'admission RPC returned invalid JSON'),
  }
}

async function waitForRowLockWaiters(applicationNames) {
  const applicationList = applicationNames.map(sqlLiteral).join(', ')
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = parseJsonSafely(
      dockerPsql(database, `
        select pg_catalog.jsonb_build_object(
          'sessionCount', count(*),
          'lockWaitCount', count(*) filter (
            where state = 'active' and wait_event_type = 'Lock'
          ),
          'distinctApplicationCount', count(distinct application_name)
        )::text
        from pg_catalog.pg_stat_activity
        where datname = ${sqlLiteral(database)}
          and application_name in (${applicationList});
      `),
      'row-lock evidence query returned invalid JSON',
    )

    if (
      latest.sessionCount === applicationNames.length
      && latest.lockWaitCount === applicationNames.length
      && latest.distinctApplicationCount === applicationNames.length
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error('admission sessions did not all reach a row-lock wait')
}

async function waitForBlockingPair(waiterName, blockerName) {
  const deadline = Date.now() + PROCESS_TIMEOUT_MS
  let latest = null

  while (Date.now() < deadline) {
    latest = parseJsonSafely(
      dockerPsql(database, `
        select pg_catalog.jsonb_build_object(
          'waiterCount', count(*),
          'lockWaitCount', count(*) filter (
            where waiter.state = 'active' and waiter.wait_event_type = 'Lock'
          ),
          'blockedByExpectedCount', count(*) filter (
            where exists (
              select 1
              from pg_catalog.unnest(
                pg_catalog.pg_blocking_pids(waiter.pid)
              ) blocking(pid)
              join pg_catalog.pg_stat_activity blocker
                on blocker.pid = blocking.pid
              where blocker.application_name = ${sqlLiteral(blockerName)}
            )
          )
        )::text
        from pg_catalog.pg_stat_activity waiter
        where waiter.datname = ${sqlLiteral(database)}
          and waiter.application_name = ${sqlLiteral(waiterName)};
      `),
      'blocking-pair evidence query returned invalid JSON',
    )

    if (
      latest.waiterCount === 1
      && latest.lockWaitCount === 1
      && latest.blockedByExpectedCount === 1
    ) {
      return latest
    }
    await delay(POLL_INTERVAL_MS)
  }

  throw new Error('expected PostgreSQL blocking pair was not observed')
}

function parseMarkedJson(output, beginMarker, endMarker) {
  const begin = output.indexOf(beginMarker)
  const end = output.indexOf(endMarker, begin + beginMarker.length)
  if (begin < 0 || end < 0) {
    throw new Error('marked admission JSON output is missing')
  }
  return parseJsonSafely(
    output.slice(begin + beginMarker.length, end).trim(),
    'marked admission output was not valid JSON',
  )
}

const subject = `ConcurrentAdmissionAdmin_${suffix}`
const issuer = `https://admission-concurrency-${suffix}.example`
const holderApplicationName = `admission_holder_${suffix}`
const waiterApplicationNames = Array.from(
  { length: 8 },
  (_, index) => `admission_waiter_${suffix}_${index}`,
)
const lockAcquiredMarker = `ADMISSION_LOCK_ACQUIRED_${suffix}`
const holderResultBeginMarker = `ADMISSION_HOLDER_RESULT_BEGIN_${suffix}`
const holderResultEndMarker = `ADMISSION_HOLDER_RESULT_END_${suffix}`
const holderCommittedMarker = `ADMISSION_HOLDER_COMMITTED_${suffix}`
const holderRequestId = randomUUID()
const deleteSubject = `DeletedConcurrentAdmissionAdmin_${suffix}`
const deleteIssuer = `https://admission-delete-concurrency-${suffix}.example`
const deleteHolderApplicationName = `admission_delete_holder_${suffix}`
const deleteWaiterApplicationName = `admission_delete_waiter_${suffix}`
const deleteLockMarker = `ADMISSION_DELETE_LOCK_ACQUIRED_${suffix}`
const deleteCommittedMarker = `ADMISSION_DELETE_COMMITTED_${suffix}`
const shareSubject = `ShareLockAdmissionAdmin_${suffix}`
const shareIssuer = `https://admission-share-lock-${suffix}.example`
const shareHolderApplicationName = `admission_share_holder_${suffix}`
const shareWaiterApplicationName = `admission_share_waiter_${suffix}`
const shareLockMarker = `ADMISSION_SHARE_LOCK_ACQUIRED_${suffix}`
const shareCommittedMarker = `ADMISSION_SHARE_COMMITTED_${suffix}`
const shareHolderRequestId = randomUUID()
const suspendedSubject = `SuspendedConcurrentAdmissionAdmin_${suffix}`
const suspendedIssuer = `https://admission-suspend-${suffix}.example`
const suspendedHolderApplicationName = `admission_suspend_holder_${suffix}`
const suspendedWaiterApplicationName = `admission_suspend_waiter_${suffix}`
const suspendedLockMarker = `ADMISSION_SUSPEND_LOCK_ACQUIRED_${suffix}`
const suspendedCommittedMarker = `ADMISSION_SUSPEND_COMMITTED_${suffix}`
let databaseCreated = false
let holderSession = null
let primaryError = null
let cleanupError = null

try {
  dockerPsql('postgres', `create database ${database};`)
  databaseCreated = true
  runMigration()

  dockerPsql(database, `
    insert into public.admin_user (user_id, note)
    values (${sqlLiteral(subject)}, '020 concurrent admission fixture');
  `)

  holderSession = startPsqlSession(database, holderApplicationName)
  holderSession.child.stdin.write(`\\set ON_ERROR_STOP on
    begin;
    set local request.jwt.claims = '{"role":"service_role"}';
    select principal_id
    from public.admin_user
    where user_id collate "C" = ${sqlLiteral(subject)} collate "C"
    for update;
\\echo ${lockAcquiredMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    lockAcquiredMarker,
    'administrator-row lock holder',
  )

  const waiterInputs = waiterApplicationNames.map((applicationName, index) => ({
    subject,
    issuer,
    tokenLabel: `concurrent-admission-token-${suffix}-${index}`,
    requestId: randomUUID(),
    applicationName,
  }))
  const waiterSettlementsPromise = Promise.allSettled(
    waiterInputs.map(input => admit(input)),
  )

  const lockEvidence = await waitForRowLockWaiters(waiterApplicationNames)
  assertSafeDeepEqual(
    lockEvidence,
    {
      sessionCount: 8,
      lockWaitCount: 8,
      distinctApplicationCount: 8,
    },
    'admission row-lock evidence was incomplete',
  )

  holderSession.child.stdin.write(`
\\echo ${holderResultBeginMarker}
    select public.admit_admin_app_session(
      'cloudbase',
      ${sqlLiteral(issuer)},
      ${sqlLiteral(subject)},
      pg_catalog.sha256(
        pg_catalog.convert_to(
          ${sqlLiteral(`concurrent-admission-holder-token-${suffix}`)},
          'UTF8'
        )
      ),
      ${sqlLiteral(holderRequestId)}::uuid
    )::text;
\\echo ${holderResultEndMarker}
    commit;
\\echo ${holderCommittedMarker}
  `)

  await waitForSessionOutput(
    holderSession,
    holderCommittedMarker,
    'administrator-row lock holder commit',
  )

  const holderPayload = parseMarkedJson(
    holderSession.stdout,
    holderResultBeginMarker,
    holderResultEndMarker,
  )
  assert.ok(holderPayload.ok === true, 'holder admission was denied')

  const waiterSettlements = await withTimeout(
    waiterSettlementsPromise,
    'blocked application-session admissions',
  )
  assert.ok(
    waiterSettlements.every(result => result.status === 'fulfilled'),
    'a blocked admission failed unexpectedly',
  )

  const waiterResults = waiterSettlements.map(result => result.value)
  const acceptedWaiters = waiterResults.filter(result => result.payload.ok === true)
  const deniedWaiters = waiterResults.filter(result => result.payload.ok === false)

  assert.ok(acceptedWaiters.length === 4, 'unexpected accepted admission count')
  assert.ok(deniedWaiters.length === 4, 'unexpected denied admission count')
  assert.ok(
    deniedWaiters.every(result => isDeepStrictEqual(result.payload, { ok: false })),
    'a denied admission returned more than the generic envelope',
  )

  const acceptedResults = [
    { payload: holderPayload, requestId: holderRequestId },
    ...acceptedWaiters,
  ]
  assert.ok(
    new Set(acceptedResults.map(result => result.payload.principalId)).size === 1,
    'concurrent admissions did not converge on one Principal',
  )

  const deniedHashList = deniedWaiters
    .map(result =>
      `pg_catalog.sha256(pg_catalog.convert_to(${sqlLiteral(result.tokenLabel)}, 'UTF8'))`,
    )
    .join(', ')
  const expectedRequestList = acceptedResults
    .map(result => sqlLiteral(result.requestId))
    .join(', ')
  const principalId = acceptedResults[0].payload.principalId

  const summary = parseJsonSafely(
    dockerPsql(database, `
      set request.jwt.claims = '{"role":"service_role"}';
      select pg_catalog.jsonb_build_object(
        'principalCount', (
          select count(*)
          from app_private.principal principal
          where principal.id = ${sqlLiteral(principalId)}::uuid
            and principal.status = 'active'
        ),
        'identityCount', (
          select count(*)
          from app_private.principal_identity identity
          where identity.provider = 'cloudbase' collate "C"
            and identity.issuer = ${sqlLiteral(issuer)} collate "C"
            and identity.subject = ${sqlLiteral(subject)} collate "C"
        ),
        'linkedAdminCount', (
          select count(*)
          from public.admin_user admin
          where admin.user_id collate "C" = ${sqlLiteral(subject)} collate "C"
            and admin.principal_id = ${sqlLiteral(principalId)}::uuid
        ),
        'liveSessionCount', (
          select count(*)
          from app_private.app_session session_row
          where session_row.principal_id = ${sqlLiteral(principalId)}::uuid
            and session_row.revoked_at is null
            and session_row.idle_expires_at > pg_catalog.clock_timestamp()
            and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
        ),
        'currentTokenCount', (
          select count(*)
          from app_private.app_session_token token
          join app_private.app_session session_row on session_row.id = token.session_id
          where session_row.principal_id = ${sqlLiteral(principalId)}::uuid
            and token.state = 'current'
        ),
        'deniedTokenCount', (
          select count(*)
          from app_private.app_session_token token
          where token.token_hash in (${deniedHashList})
        ),
        'principalAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.action = 'principal.created'
            and audit.entity_id = ${sqlLiteral(principalId)}
        ),
        'sessionAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.action = 'session.created'
            and audit.actor_principal_id = ${sqlLiteral(principalId)}::uuid
        ),
        'unexpectedSessionAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.action = 'session.created'
            and audit.actor_principal_id = ${sqlLiteral(principalId)}::uuid
            and audit.request_id not in (${expectedRequestList})
        ),
        'sensitiveAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where (
            audit.actor_principal_id = ${sqlLiteral(principalId)}::uuid
            or audit.entity_id = ${sqlLiteral(principalId)}
          )
            and (
              audit.metadata <> '{}'::jsonb
              or audit.metadata::text like ${sqlLiteral(`%${subject}%`)}
              or audit.metadata::text like ${sqlLiteral(`%${issuer}%`)}
            )
        ),
        'authorization', public.authorize_admin_principal(
          ${sqlLiteral(principalId)}::uuid
        )
      )::text;
    `),
    'concurrent admission summary returned invalid JSON',
  )

  assertSafeDeepEqual(
    summary,
    {
      principalCount: 1,
      identityCount: 1,
      linkedAdminCount: 1,
      liveSessionCount: 5,
      currentTokenCount: 5,
      deniedTokenCount: 0,
      principalAuditCount: 1,
      sessionAuditCount: 5,
      unexpectedSessionAuditCount: 0,
      sensitiveAuditCount: 0,
      authorization: { ok: true, authorized: true },
    },
    'concurrent admission summary was incorrect',
  )

  await closePsqlSession(holderSession)
  holderSession = null

  // Prove allowlist removal linearizes through the administrator-row lock. An
  // admission already waiting on the row must observe the committed deletion,
  // return only the generic denial, and create no identity/session state.
  dockerPsql(database, `
    insert into public.admin_user (user_id, note)
    values (${sqlLiteral(deleteSubject)}, '020 concurrent deletion fixture');
  `)

  holderSession = startPsqlSession(database, deleteHolderApplicationName)
  holderSession.child.stdin.write(`\\set ON_ERROR_STOP on
    begin;
    select principal_id
    from public.admin_user
    where user_id collate "C" = ${sqlLiteral(deleteSubject)} collate "C"
    for update;
\\echo ${deleteLockMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    deleteLockMarker,
    'administrator deletion lock holder',
  )

  const deletedAdmissionPromise = admit({
    subject: deleteSubject,
    issuer: deleteIssuer,
    tokenLabel: `deleted-concurrent-admission-token-${suffix}`,
    requestId: randomUUID(),
    applicationName: deleteWaiterApplicationName,
  })
  const deleteLockEvidence = await waitForBlockingPair(
    deleteWaiterApplicationName,
    deleteHolderApplicationName,
  )
  assertSafeDeepEqual(
    deleteLockEvidence,
    {
      waiterCount: 1,
      lockWaitCount: 1,
      blockedByExpectedCount: 1,
    },
    'administrator deletion lock evidence was incomplete',
  )

  holderSession.child.stdin.write(`
    delete from public.admin_user
    where user_id collate "C" = ${sqlLiteral(deleteSubject)} collate "C";
    commit;
\\echo ${deleteCommittedMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    deleteCommittedMarker,
    'administrator deletion commit',
  )

  const deletedAdmission = await withTimeout(
    deletedAdmissionPromise,
    'admission waiting behind administrator deletion',
  )
  assertSafeDeepEqual(
    deletedAdmission.payload,
    { ok: false },
    'admission did not observe the committed allowlist deletion',
  )

  const deletionSummary = parseJsonSafely(
    dockerPsql(database, `
      select pg_catalog.jsonb_build_object(
        'adminCount', (
          select count(*)
          from public.admin_user admin
          where admin.user_id collate "C" = ${sqlLiteral(deleteSubject)} collate "C"
        ),
        'identityCount', (
          select count(*)
          from app_private.principal_identity identity
          where identity.provider = 'cloudbase' collate "C"
            and identity.issuer = ${sqlLiteral(deleteIssuer)} collate "C"
            and identity.subject = ${sqlLiteral(deleteSubject)} collate "C"
        ),
        'tokenCount', (
          select count(*)
          from app_private.app_session_token token
          where token.token_hash = pg_catalog.sha256(
            pg_catalog.convert_to(
              ${sqlLiteral(`deleted-concurrent-admission-token-${suffix}`)},
              'UTF8'
            )
          )
        ),
        'auditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.request_id = ${sqlLiteral(deletedAdmission.requestId)}::uuid
        )
      )::text;
    `),
    'administrator deletion summary returned invalid JSON',
  )
  assertSafeDeepEqual(
    deletionSummary,
    {
      adminCount: 0,
      identityCount: 0,
      tokenCount: 0,
      auditCount: 0,
    },
    'administrator deletion summary was incorrect',
  )

  await closePsqlSession(holderSession)
  holderSession = null

  // Start with four committed families. A transaction that creates the fifth
  // through migration 019 retains its Principal SHARE lock until commit. The
  // 020 admission must wait for that lock, resample the newly committed fifth
  // family, and deny its candidate instead of committing a sixth.
  const shareFixture = parseJsonSafely(
    dockerPsql(database, `
      set request.jwt.claims = '{"role":"service_role"}';
      insert into public.admin_user (user_id, note)
      values (${sqlLiteral(shareSubject)}, '020 Principal SHARE fixture');
      do $fixture$
      declare
        v_index integer;
        v_result jsonb;
      begin
        for v_index in 1..4 loop
          v_result := public.admit_admin_app_session(
            'cloudbase',
            ${sqlLiteral(shareIssuer)},
            ${sqlLiteral(shareSubject)},
            pg_catalog.sha256(
              pg_catalog.convert_to(
                'share-lock-admission-token-${suffix}-' || v_index,
                'UTF8'
              )
            ),
            pg_catalog.gen_random_uuid()
          );
          if not coalesce((v_result ->> 'ok')::boolean, false) then
            raise exception 'Principal SHARE fixture admission was denied';
          end if;
        end loop;
      end
      $fixture$;
      select pg_catalog.jsonb_build_object(
        'principalId', admin.principal_id,
        'lastVerifiedAt', identity.last_verified_at,
        'liveSessionCount', (
          select count(*)
          from app_private.app_session session_row
          where session_row.principal_id = admin.principal_id
            and session_row.revoked_at is null
            and session_row.idle_expires_at > pg_catalog.clock_timestamp()
            and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
        )
      )::text
      from public.admin_user admin
      join app_private.principal_identity identity
        on identity.principal_id = admin.principal_id
      where admin.user_id collate "C" = ${sqlLiteral(shareSubject)} collate "C";
    `),
    'Principal SHARE fixture returned invalid JSON',
  )
  assert.ok(
    shareFixture.liveSessionCount === 4,
    'Principal SHARE fixture has an unexpected live-session count',
  )
  assert.ok(
    /^[0-9a-f-]{36}$/.test(shareFixture.principalId),
    'Principal SHARE fixture returned an invalid Principal identifier',
  )

  holderSession = startPsqlSession(database, shareHolderApplicationName)
  holderSession.child.stdin.write(`\\set ON_ERROR_STOP on
    begin;
    set local request.jwt.claims = '{"role":"service_role"}';
    select public.create_app_session(
      ${sqlLiteral(shareFixture.principalId)}::uuid,
      pg_catalog.sha256(
        pg_catalog.convert_to(
          ${sqlLiteral(`share-lock-holder-token-${suffix}`)},
          'UTF8'
        )
      ),
      ${sqlLiteral(shareHolderRequestId)}::uuid
    )::text;
\\echo ${shareLockMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    shareLockMarker,
    'migration 019 Principal SHARE lock holder',
  )

  const shareAdmissionPromise = admit({
    subject: shareSubject,
    issuer: shareIssuer,
    tokenLabel: `share-lock-denied-token-${suffix}`,
    requestId: randomUUID(),
    applicationName: shareWaiterApplicationName,
  })
  const shareLockEvidence = await waitForBlockingPair(
    shareWaiterApplicationName,
    shareHolderApplicationName,
  )
  assertSafeDeepEqual(
    shareLockEvidence,
    {
      waiterCount: 1,
      lockWaitCount: 1,
      blockedByExpectedCount: 1,
    },
    'Principal SHARE lock evidence was incomplete',
  )

  holderSession.child.stdin.write(`
    commit;
\\echo ${shareCommittedMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    shareCommittedMarker,
    'migration 019 Principal SHARE commit',
  )

  const shareAdmission = await withTimeout(
    shareAdmissionPromise,
    'admission waiting behind migration 019 Principal SHARE lock',
  )
  assertSafeDeepEqual(
    shareAdmission.payload,
    { ok: false },
    'admission did not resample the fifth committed family',
  )

  const shareSummary = parseJsonSafely(
    dockerPsql(database, `
      select pg_catalog.jsonb_build_object(
        'lastVerifiedAt', (
          select identity.last_verified_at
          from app_private.principal_identity identity
          where identity.principal_id =
            ${sqlLiteral(shareFixture.principalId)}::uuid
        ),
        'liveSessionCount', (
          select count(*)
          from app_private.app_session session_row
          where session_row.principal_id =
              ${sqlLiteral(shareFixture.principalId)}::uuid
            and session_row.revoked_at is null
            and session_row.idle_expires_at > pg_catalog.clock_timestamp()
            and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
        ),
        'holderTokenCount', (
          select count(*)
          from app_private.app_session_token token
          where token.token_hash = pg_catalog.sha256(
            pg_catalog.convert_to(
              ${sqlLiteral(`share-lock-holder-token-${suffix}`)},
              'UTF8'
            )
          )
        ),
        'deniedTokenCount', (
          select count(*)
          from app_private.app_session_token token
          where token.token_hash = pg_catalog.sha256(
            pg_catalog.convert_to(
              ${sqlLiteral(`share-lock-denied-token-${suffix}`)},
              'UTF8'
            )
          )
        ),
        'holderAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.request_id = ${sqlLiteral(shareHolderRequestId)}::uuid
        ),
        'deniedAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.request_id = ${sqlLiteral(shareAdmission.requestId)}::uuid
        )
      )::text;
    `),
    'Principal SHARE summary returned invalid JSON',
  )
  assertSafeDeepEqual(
    shareSummary,
    {
      lastVerifiedAt: shareFixture.lastVerifiedAt,
      liveSessionCount: 5,
      holderTokenCount: 1,
      deniedTokenCount: 0,
      holderAuditCount: 1,
      deniedAuditCount: 0,
    },
    'Principal SHARE summary was incorrect',
  )

  await closePsqlSession(holderSession)
  holderSession = null

  // A status writer holds the same Principal UPDATE lock used by admission.
  // The queued admission must resample the committed suspended state and roll
  // back its identity verification touch and session candidate.
  const suspendedFixture = parseJsonSafely(
    dockerPsql(database, `
      set request.jwt.claims = '{"role":"service_role"}';
      insert into public.admin_user (user_id, note)
      values (${sqlLiteral(suspendedSubject)}, '020 Principal status fixture');
      select public.admit_admin_app_session(
        'cloudbase',
        ${sqlLiteral(suspendedIssuer)},
        ${sqlLiteral(suspendedSubject)},
        pg_catalog.sha256(
          pg_catalog.convert_to(
            ${sqlLiteral(`suspended-initial-token-${suffix}`)},
            'UTF8'
          )
        ),
        pg_catalog.gen_random_uuid()
      );
      select pg_catalog.jsonb_build_object(
        'principalId', admin.principal_id,
        'lastVerifiedAt', identity.last_verified_at
      )::text
      from public.admin_user admin
      join app_private.principal_identity identity
        on identity.principal_id = admin.principal_id
      where admin.user_id collate "C" =
        ${sqlLiteral(suspendedSubject)} collate "C";
    `).split('\n').at(-1),
    'Principal suspension fixture returned invalid JSON',
  )
  assert.ok(
    /^[0-9a-f-]{36}$/.test(suspendedFixture.principalId),
    'Principal suspension fixture returned an invalid Principal identifier',
  )

  holderSession = startPsqlSession(database, suspendedHolderApplicationName)
  holderSession.child.stdin.write(`\\set ON_ERROR_STOP on
    begin;
    select status
    from app_private.principal
    where id = ${sqlLiteral(suspendedFixture.principalId)}::uuid
    for update;
\\echo ${suspendedLockMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    suspendedLockMarker,
    'Principal suspension lock holder',
  )

  const suspendedAdmissionPromise = admit({
    subject: suspendedSubject,
    issuer: suspendedIssuer,
    tokenLabel: `suspended-denied-token-${suffix}`,
    requestId: randomUUID(),
    applicationName: suspendedWaiterApplicationName,
  })
  const suspendedLockEvidence = await waitForBlockingPair(
    suspendedWaiterApplicationName,
    suspendedHolderApplicationName,
  )
  assertSafeDeepEqual(
    suspendedLockEvidence,
    {
      waiterCount: 1,
      lockWaitCount: 1,
      blockedByExpectedCount: 1,
    },
    'Principal suspension lock evidence was incomplete',
  )

  holderSession.child.stdin.write(`
    update app_private.principal
    set status = 'suspended'
    where id = ${sqlLiteral(suspendedFixture.principalId)}::uuid;
    commit;
\\echo ${suspendedCommittedMarker}
  `)
  await waitForSessionOutput(
    holderSession,
    suspendedCommittedMarker,
    'Principal suspension commit',
  )

  const suspendedAdmission = await withTimeout(
    suspendedAdmissionPromise,
    'admission waiting behind Principal suspension',
  )
  assertSafeDeepEqual(
    suspendedAdmission.payload,
    { ok: false },
    'admission did not observe the committed Principal suspension',
  )

  const suspendedSummary = parseJsonSafely(
    dockerPsql(database, `
      set request.jwt.claims = '{"role":"service_role"}';
      select pg_catalog.jsonb_build_object(
        'principalStatus', (
          select principal.status
          from app_private.principal principal
          where principal.id = ${sqlLiteral(suspendedFixture.principalId)}::uuid
        ),
        'lastVerifiedAt', (
          select identity.last_verified_at
          from app_private.principal_identity identity
          where identity.principal_id =
            ${sqlLiteral(suspendedFixture.principalId)}::uuid
        ),
        'sessionCount', (
          select count(*)
          from app_private.app_session session_row
          where session_row.principal_id =
            ${sqlLiteral(suspendedFixture.principalId)}::uuid
        ),
        'deniedTokenCount', (
          select count(*)
          from app_private.app_session_token token
          where token.token_hash = pg_catalog.sha256(
            pg_catalog.convert_to(
              ${sqlLiteral(`suspended-denied-token-${suffix}`)},
              'UTF8'
            )
          )
        ),
        'deniedAuditCount', (
          select count(*)
          from app_private.audit_event audit
          where audit.request_id = ${sqlLiteral(suspendedAdmission.requestId)}::uuid
        ),
        'authorization', public.authorize_admin_principal(
          ${sqlLiteral(suspendedFixture.principalId)}::uuid
        )
      )::text;
    `),
    'Principal suspension summary returned invalid JSON',
  )
  assertSafeDeepEqual(
    suspendedSummary,
    {
      principalStatus: 'suspended',
      lastVerifiedAt: suspendedFixture.lastVerifiedAt,
      sessionCount: 1,
      deniedTokenCount: 0,
      deniedAuditCount: 0,
      authorization: { ok: true, authorized: false },
    },
    'Principal suspension summary was incorrect',
  )

  console.log(
    'application-session admission lock-order, exact-cap, authority-loss, and expiry tests passed',
  )
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
          'Application-session admission test database cleanup failed twice',
        ),
      )
    }
  }

  if (cleanupErrors.length === 1) cleanupError = cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    cleanupError = new AggregateError(
      cleanupErrors,
      'Application-session admission test cleanup failed',
    )
  }
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    'Application-session admission concurrency test and cleanup failed',
  )
}
if (primaryError) throw primaryError
if (cleanupError) throw cleanupError
