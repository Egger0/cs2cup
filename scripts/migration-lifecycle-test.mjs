import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { migrationChecksum } from './migration-checksum.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const suffix = `${process.pid}_${randomBytes(4).toString('hex')}`
const upgradeDatabase = `cs2cup_migration_upgrade_${suffix}`
const freshDatabase = `cs2cup_migration_fresh_${suffix}`
const partialDatabase = `cs2cup_migration_partial_${suffix}`
const unsafeDatabase = `cs2cup_migration_unsafe_${suffix}`
const identityFailureDatabase = `cs2cup_migration_identity_failure_${suffix}`
const sessionUpgradeDatabase = `cs2cup_migration_session_upgrade_${suffix}`
const sessionFailureDatabase = `cs2cup_migration_session_failure_${suffix}`
const admissionUpgradeDatabase = `cs2cup_migration_admission_upgrade_${suffix}`
const contractDatabase = `cs2cup_migration_contract_${suffix}`
const externalDatabase = `cs2cup_migration_external_${suffix}`
const concurrentDatabase = `cs2cup_migration_concurrent_${suffix}`
const MIGRATION_LOCK_CLASS_ID = 1129521731
const MIGRATION_LOCK_OBJECT_ID = 1296647246
const externalPsqlAvailable = spawnSync('psql', ['--version'], {
  stdio: 'ignore',
}).status === 0
if (process.env.MIGRATION_REQUIRE_EXTERNAL_TEST === '1' && !externalPsqlAvailable) {
  throw new Error('MIGRATION_REQUIRE_EXTERNAL_TEST=1 but psql is unavailable')
}
const databases = [
  upgradeDatabase,
  freshDatabase,
  partialDatabase,
  unsafeDatabase,
  identityFailureDatabase,
  sessionUpgradeDatabase,
  sessionFailureDatabase,
  admissionUpgradeDatabase,
  contractDatabase,
  concurrentDatabase,
  ...(externalPsqlAvailable ? [externalDatabase] : []),
]
const migrationFiles = directory =>
  readdirSync(join(ROOT, 'migrations', directory))
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
const expandMigrationCount = migrationFiles('').length
const sessionFoundationMigrationCount = migrationFiles('').filter(
  file => file.slice(0, 3) <= '019',
).length
const contractMigrationCount = migrationFiles('post-deploy').length

function dockerPsql(database, args, input) {
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
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...args,
    ],
    { cwd: ROOT, encoding: 'utf8', input },
  )

  if (result.status !== 0) {
    process.stderr.write(result.stdout)
    process.stderr.write(result.stderr)
    throw new Error(`psql failed for ${database}`)
  }
  return result.stdout.trim()
}

function dockerPsqlFailure(database, args, input) {
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
      database,
      '-v',
      'ON_ERROR_STOP=1',
      ...args,
    ],
    { cwd: ROOT, encoding: 'utf8', input },
  )
  if (result.status === 0) {
    throw new Error(`psql unexpectedly succeeded for ${database}`)
  }
  return `${result.stdout}${result.stderr}`
}

function runMigration(
  database,
  phase = 'expand',
  {
    baseline = false,
    expectFailure = false,
    external = false,
    maxVersion,
  } = {},
) {
  const args = ['scripts/migrate.mjs']
  if (phase === 'contract') args.push('--phase', 'contract')
  if (baseline) args.push('--baseline', '012')
  const environment = { ...process.env }
  delete environment.MIGRATION_DATABASE_URL
  delete environment.MIGRATION_EXPECT_DATABASE
  delete environment.MIGRATION_DB_NAME
  delete environment.MIGRATION_TEST_MAX_VERSION
  delete environment.MIGRATION_ENABLE_TEST_CONTROLS
  if (maxVersion) {
    environment.MIGRATION_TEST_MAX_VERSION = maxVersion
    environment.MIGRATION_ENABLE_TEST_CONTROLS = '1'
  }
  if (external) {
    environment.MIGRATION_DATABASE_URL =
      `postgresql://postgres:dev@127.0.0.1:55432/${database}`
    environment.MIGRATION_EXPECT_DATABASE = database
    environment.PGHOSTADDR = '192.0.2.1'
    environment.PGSERVICE = 'must-not-be-used'
    environment.PGSERVICEFILE = '/definitely/not/a/libpq/service/file'
  } else {
    environment.MIGRATION_DB_NAME = database
  }
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: environment,
  })

  process.stdout.write(result.stdout)
  if (expectFailure) {
    if (result.status === 0) {
      throw new Error(`${phase} migration unexpectedly succeeded for ${database}`)
    }
    return `${result.stdout}${result.stderr}`
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    throw new Error(`${phase} migration runner failed for ${database}`)
  }
}

function startMigrationRunner(database) {
  const environment = { ...process.env, MIGRATION_DB_NAME: database }
  for (const name of [
    'MIGRATION_DATABASE_URL',
    'MIGRATION_EXPECT_DATABASE',
    'MIGRATION_TEST_MAX_VERSION',
    'MIGRATION_ENABLE_TEST_CONTROLS',
  ]) {
    delete environment[name]
  }

  const child = spawn(process.execPath, ['scripts/migrate.mjs'], {
    cwd: ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => {
    output += chunk
  })
  child.stderr.on('data', chunk => {
    output += chunk
  })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve({ code, output }))
  })
  return { child, completion, output: () => output }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function acquireMigrationTestBarrier(database) {
  const marker = 'CS2CUP_MIGRATION_TEST_LOCK_ACQUIRED'
  const child = spawn(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-q',
      '-At',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  const acquired = new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('timed out acquiring the migration concurrency test barrier'))
    }, 10_000)
    const settle = callback => value => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    const succeed = settle(resolve)
    const fail = settle(reject)

    child.stdout.on('data', () => {
      const match = stdout.match(new RegExp(`${marker}:(\\d+)`))
      if (match) succeed(Number(match[1]))
    })
    child.once('error', fail)
    child.once('exit', code => {
      fail(
        new Error(
          `migration concurrency test barrier exited with ${code ?? 'unknown status'}` +
            (stderr ? `: ${stderr.trim()}` : ''),
        ),
      )
    })
  })

  child.stdin.write(
    `set statement_timeout = '10s';\n` +
      `select pg_catalog.pg_advisory_lock(${MIGRATION_LOCK_CLASS_ID}, ${MIGRATION_LOCK_OBJECT_ID});\n` +
      `reset statement_timeout;\n` +
      `select '${marker}:' || pg_catalog.pg_backend_pid();\n`,
  )

  try {
    const backendPid = await acquired
    return { backendPid, child, stderr: () => stderr }
  } catch (error) {
    child.stdin.destroy()
    child.kill('SIGKILL')
    throw error
  }
}

async function releaseMigrationTestBarrier(barrier) {
  if (barrier.child.exitCode !== null || barrier.child.signalCode !== null) return

  const exited = new Promise(resolve => barrier.child.once('exit', resolve))
  barrier.child.stdin.end(
    `select pg_catalog.pg_advisory_unlock(${MIGRATION_LOCK_CLASS_ID}, ${MIGRATION_LOCK_OBJECT_ID});\n` +
      '\\q\n',
  )
  const timedOut = Symbol('timed-out')
  let timeout
  const result = await Promise.race([
    exited,
    new Promise(resolve => {
      timeout = setTimeout(() => resolve(timedOut), 5_000)
    }),
  ])
  clearTimeout(timeout)
  if (result === timedOut) {
    barrier.child.kill('SIGKILL')
    await exited
    throw new Error('timed out releasing the migration concurrency test barrier')
  }
  if (result !== 0) {
    throw new Error(
      `migration concurrency test barrier exited with ${result ?? 'unknown status'}` +
        (barrier.stderr() ? `: ${barrier.stderr().trim()}` : ''),
    )
  }
}

function migrationLockEvidence(database) {
  const output = dockerPsql(database, [
    '-At',
    '-F',
    '\t',
    '-c',
    `select
       lock.pid,
       lock.granted,
       activity.state,
       coalesce(activity.wait_event_type, ''),
       coalesce(activity.wait_event, ''),
       coalesce(array_to_string(pg_catalog.pg_blocking_pids(lock.pid), ','), '')
     from pg_catalog.pg_locks lock
     join pg_catalog.pg_stat_activity activity on activity.pid = lock.pid
     where lock.locktype = 'advisory'
       and lock.database = (
         select oid from pg_catalog.pg_database where datname = pg_catalog.current_database()
       )
       and lock.classid = ${MIGRATION_LOCK_CLASS_ID}
       and lock.objid = ${MIGRATION_LOCK_OBJECT_ID}
     order by lock.granted desc, lock.pid`,
  ])

  return output
    ? output.split('\n').map(row => {
        const [pid, granted, state, waitEventType, waitEvent, blockingPids] =
          row.split('\t')
        return {
          pid: Number(pid),
          granted: granted === 't',
          state,
          waitEventType,
          waitEvent,
          blockingPids: blockingPids
            ? blockingPids.split(',').map(value => Number(value))
            : [],
        }
      })
    : []
}

async function proveMigrationRunnersBlocked(database, barrier, runners) {
  const deadline = Date.now() + 10_000
  let evidence = []

  while (Date.now() < deadline) {
    const exitedRunner = runners.find(runner => runner.child.exitCode !== null)
    if (exitedRunner) {
      throw new Error(
        `migration runner exited before lock-wait evidence was captured: ${exitedRunner.output()}`,
      )
    }

    evidence = migrationLockEvidence(database)
    const holder = evidence.find(
      lock => lock.pid === barrier.backendPid && lock.granted,
    )
    const waiters = evidence.filter(lock => !lock.granted)
    if (
      holder &&
      waiters.length === runners.length &&
      waiters.every(
        waiter =>
          waiter.state === 'active' &&
          waiter.waitEventType === 'Lock' &&
          waiter.waitEvent === 'advisory' &&
          waiter.blockingPids.includes(barrier.backendPid),
      )
    ) {
      console.log(
        `concurrent migration lock evidence passed: holder=${barrier.backendPid}, ` +
          `blocked-runners=${waiters.length}, wait=Lock/advisory`,
      )
      return
    }
    await wait(50)
  }

  const summary = evidence.map(lock => ({
    pid: lock.pid,
    granted: lock.granted,
    state: lock.state,
    wait: `${lock.waitEventType}/${lock.waitEvent}`,
    blockerCount: lock.blockingPids.length,
  }))
  throw new Error(
    `migration runners did not produce advisory-lock wait evidence: ${JSON.stringify(summary)}`,
  )
}

function assertLifecycle(database, expected) {
  const ledgerPrivilegeMismatch =
    expected === 'expanded'
      ? `not (
          has_table_privilege('club_admin', 'public.registration_attempt', 'select')
          and has_table_privilege('club_admin', 'public.registration_attempt', 'insert')
        )`
      : `(
          has_table_privilege('club_admin', 'public.registration_attempt', 'select')
          or has_table_privilege('club_admin', 'public.registration_attempt', 'insert')
        )`

  dockerPsql(
    database,
    ['-q', '-f', '-'],
    `
do $test$
declare
  v_legacy_submit regprocedure := to_regprocedure('public.submit_team(jsonb)');
  v_legacy_recent regprocedure :=
    to_regprocedure('public.recent_registration_attempts(text,integer)');
begin
  if not has_function_privilege(
    'club_admin',
    'public.submit_team_rate_limited(text,jsonb)',
    'execute'
  ) then
    raise exception 'new app cannot execute guarded registration RPC';
  end if;

  if '${expected}' = 'expanded' then
    if v_legacy_submit is null then
      raise exception 'old submit RPC is unavailable in expanded state';
    end if;
    if not has_function_privilege('club_admin', v_legacy_submit, 'execute') then
      raise exception 'old submit RPC is unavailable in expanded state';
    end if;
    if v_legacy_recent is null then
      raise exception 'old ledger RPC is unavailable in expanded state';
    end if;
    if not has_function_privilege('club_admin', v_legacy_recent, 'execute') then
      raise exception 'old ledger RPC is unavailable in expanded state';
    end if;
  elsif v_legacy_submit is not null or v_legacy_recent is not null then
    raise exception 'legacy registration endpoint still exists after contraction';
  end if;

  if ${ledgerPrivilegeMismatch} then
    raise exception 'old ledger table privileges do not match ${expected} state';
  end if;
end
$test$;
`,
  )
}

function assertRpcClaims(database, expected) {
  dockerPsql(
    database,
    ['-q', '-f', '-'],
    `
begin;
grant usage on schema public to anon_authenticator;
grant execute on all functions in schema public to anon_authenticator;
set session authorization anon_authenticator;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $test$
begin
  perform public.registration_status('2026-nlc');

  begin
    perform public.submit_team_rate_limited(
      'v1:' || repeat('a', 64),
      jsonb_build_object('slug', 'claims-anon-denied')
    );
    raise exception 'anon reached guarded registration RPC';
  exception
    when insufficient_privilege then null;
  end;

  if to_regprocedure('public.submit_team(jsonb)') is not null then
    begin
      perform public.submit_team('{}'::jsonb);
      raise exception 'anon reached legacy registration RPC';
    exception
      when insufficient_privilege then null;
    end;
  end if;
end
$test$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $test$
declare
  v_result jsonb;
begin
  v_result := public.submit_team_rate_limited(
    'v1:' || repeat('b', 64),
    jsonb_build_object('slug', 'claims-service-probe')
  );
  if v_result ->> 'error' is distinct from '当前赛事不存在或不可报名' then
    raise exception 'service_role did not reach guarded registration RPC';
  end if;

  if '${expected}' = 'expanded' then
    if to_regprocedure('public.submit_team(jsonb)') is null then
      raise exception 'expanded state is missing the legacy RPC';
    end if;
    v_result := public.submit_team('{}'::jsonb);
    if v_result ->> 'error' is null then
      raise exception 'service_role did not reach the legacy RPC';
    end if;
  elsif to_regprocedure('public.submit_team(jsonb)') is not null then
    raise exception 'contracted state still exposes the legacy RPC';
  end if;
end
$test$;

reset session authorization;
rollback;
`,
  )
}

function ledgerCount(database, phase) {
  return Number(
    dockerPsql(database, [
      '-At',
      '-c',
      `select count(*) from public.schema_migration where phase='${phase}'`,
    ]),
  )
}

function assertIdentityFoundationsEmpty(database) {
  const result = dockerPsql(database, [
    '-At',
    '-c',
    `select
       not exists (
         select 1 from app_private.principal
         union all select 1 from app_private.principal_identity
         union all select 1 from app_private.principal_profile
         union all select 1 from app_private.role_assignment
         union all select 1 from app_private.team_ownership
         union all select 1 from app_private.audit_event
       )
       and not exists (
         select 1 from public.admin_user where principal_id is not null
       )
       and not exists (
         select 1 from public.player where principal_id is not null
       )`,
  ])
  if (result !== 't') {
    throw new Error(`identity migration fabricated rows or compatibility links in ${database}`)
  }
}

function assertSessionFoundationsEmpty(database) {
  const result = dockerPsql(database, [
    '-At',
    '-c',
    `select not exists (
       select 1 from app_private.app_session
       union all select 1 from app_private.app_session_token
       union all select 1 from app_private.login_throttle
       union all select 1 from app_private.audit_event where action like 'session.%'
     )`,
  ])
  if (result !== 't') {
    throw new Error(`session migration fabricated state in ${database}`)
  }
}

function applicationAdmissionSentinel(database) {
  return dockerPsql(database, [
    '-At',
    '-c',
    `select jsonb_build_object(
       'principal', (
         select to_jsonb(principal.*)
         from app_private.principal principal
         where principal.id = '02000000-0000-4000-8000-000000000001'
       ),
       'identity', (
         select to_jsonb(identity.*)
         from app_private.principal_identity identity
         where identity.principal_id = '02000000-0000-4000-8000-000000000001'
       ),
       'admin', (
         select to_jsonb(admin.*)
         from public.admin_user admin
         where admin.principal_id = '02000000-0000-4000-8000-000000000001'
       ),
       'sessions', (
         select coalesce(
           jsonb_agg(to_jsonb(session_row.*) order by session_row.id),
           '[]'::jsonb
         )
         from app_private.app_session session_row
         where session_row.principal_id = '02000000-0000-4000-8000-000000000001'
       ),
       'tokens', (
         select coalesce(
           jsonb_agg(
             to_jsonb(token.*)
             order by pg_catalog.encode(token.token_hash, 'hex')
           ),
           '[]'::jsonb
         )
         from app_private.app_session_token token
         join app_private.app_session session_row on session_row.id = token.session_id
         where session_row.principal_id = '02000000-0000-4000-8000-000000000001'
       ),
       'audits', (
         select coalesce(
           jsonb_agg(to_jsonb(audit.*) order by audit.id),
           '[]'::jsonb
         )
         from app_private.audit_event audit
         where audit.actor_principal_id = '02000000-0000-4000-8000-000000000001'
            or (
              audit.action = 'migration.admission_upgrade'
              and audit.entity_id = '02000000-0000-4000-8000-000000000001'
            )
       )
     )::text`,
  ])
}

try {
  for (const database of databases) {
    dockerPsql('postgres', ['-q', '-c', `create database ${database}`])
  }

  // Reproduce the pre-ledger main schema exactly, then adopt it in place.
  const legacyFiles = readdirSync(join(ROOT, 'migrations'))
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file) && file.slice(0, 3) <= '012')
    .sort()
  const legacySql = legacyFiles
    .map(file => readFileSync(join(ROOT, 'migrations', file), 'utf8'))
    .join('\n')

  dockerPsql(
    partialDatabase,
    ['-q', '-f', '-'],
    `create table public.site_setting (id integer primary key);`,
  )
  const partialRefusal = runMigration(partialDatabase, 'expand', { expectFailure: true })
  if (!partialRefusal.includes('Existing unledgered schema detected')) {
    throw new Error('partial application schema was misclassified as fresh')
  }
  if (
    dockerPsql(
      partialDatabase,
      ['-At', '-c', `select to_regclass('public.schema_migration') is null`],
    ) !== 't'
  ) {
    throw new Error('partial-schema refusal wrote a migration ledger')
  }

  dockerPsql(unsafeDatabase, ['--single-transaction', '-q', '-f', '-'], legacySql)
  dockerPsql(
    unsafeDatabase,
    ['-q', '-f', '-'],
    `alter table public.team disable row level security;
     grant update on table public.registration_attempt to authenticated;
     grant execute on function public.submit_team(jsonb) to anon;
     grant execute on function public.replace_match_schedule(
       bigint, bigint[], timestamptz[], timestamptz[]
     ) to anon;`,
  )
  const unsafeRefusal = runMigration(unsafeDatabase, 'expand', {
    baseline: true,
    expectFailure: true,
  })
  if (!unsafeRefusal.includes('Schema does not match the verified main/012 baseline')) {
    throw new Error('insecure legacy schema was accepted as the 012 baseline')
  }
  if (
    dockerPsql(
      unsafeDatabase,
      ['-At', '-c', `select to_regclass('public.schema_migration') is null`],
    ) !== 't'
  ) {
    throw new Error('insecure-baseline refusal wrote a migration ledger')
  }

  // A late public-wrapper conflict in the additive identity migration must
  // roll back its private tables, bridge columns, triggers, helper function,
  // and ledger write while preserving the pre-existing conflicting object.
  runMigration(identityFailureDatabase, 'expand', { maxVersion: '017' })
  dockerPsql(
    identityFailureDatabase,
    [
      '-q',
      '-c',
      `create function public.ensure_principal_identity(text, text, text)
       returns text
       language sql
       immutable
       set search_path = pg_catalog
       as 'select ''preexisting''::text'`,
    ],
  )
  const identityFailure = runMigration(identityFailureDatabase, 'expand', {
    expectFailure: true,
  })
  if (!identityFailure.includes('cannot change return type of existing function')) {
    throw new Error('identity migration conflict did not report the wrapper return type')
  }
  if (
    dockerPsql(
      identityFailureDatabase,
      [
        '-At',
        '-c',
        `select
           to_regclass('app_private.principal') is null
           and to_regprocedure(
             'app_private.ensure_principal_identity(text,text,text)'
           ) is null
           and pg_get_function_result(
             'public.ensure_principal_identity(text,text,text)'::regprocedure
           ) = 'text'
           and not exists (
             select 1
             from information_schema.columns
             where table_schema = 'public'
               and table_name in ('admin_user', 'player')
               and column_name = 'principal_id'
           )
           and not exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '018\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
  ) {
    throw new Error('failed identity migration left partial schema or ledger state')
  }
  dockerPsql(identityFailureDatabase, [
    '-q',
    '-c',
    'drop function public.ensure_principal_identity(text, text, text)',
  ])
  runMigration(identityFailureDatabase)
  assertIdentityFoundationsEmpty(identityFailureDatabase)
  assertSessionFoundationsEmpty(identityFailureDatabase)
  if (
    dockerPsql(
      identityFailureDatabase,
      [
        '-At',
        '-c',
        `select
           to_regclass('app_private.principal') is not null
           and exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '018\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
  ) {
    throw new Error('identity migration did not recover after the conflict was removed')
  }

  // The final 019 wrapper is an intentional late-failure fixture. A conflict
  // there must roll back every private table, helper, wrapper, and ledger row
  // while preserving both 018 data and the pre-existing object.
  runMigration(sessionFailureDatabase, 'expand', { maxVersion: '018' })
  dockerPsql(
    sessionFailureDatabase,
    ['-q', '-f', '-'],
    `insert into app_private.principal (id)
       values ('01900000-0000-4000-8000-000000000001');
     insert into app_private.audit_event (
       actor_type, action, entity_type, entity_id, metadata
     ) values (
       'system',
       'migration.session_sentinel',
       'principal',
       '01900000-0000-4000-8000-000000000001',
       '{"source":"018"}'::jsonb
     );
     create function public.cleanup_app_sessions(integer, uuid)
     returns text
     language sql
     immutable
     set search_path = pg_catalog
     as 'select ''preexisting''::text';`,
  )
  const sessionFailure = runMigration(sessionFailureDatabase, 'expand', {
    expectFailure: true,
  })
  if (
    !sessionFailure.includes('already exists with same argument types')
    && !sessionFailure.includes('cannot change return type of existing function')
  ) {
    throw new Error(
      `session migration conflict did not report the wrapper collision: ${sessionFailure}`,
    )
  }
  if (
    dockerPsql(
      sessionFailureDatabase,
      [
        '-At',
        '-c',
        `select
           to_regclass('app_private.app_session') is null
           and to_regclass('app_private.app_session_token') is null
           and to_regclass('app_private.login_throttle') is null
           and to_regprocedure(
             'app_private.cleanup_app_sessions(integer,uuid)'
           ) is null
           and to_regprocedure('public.create_app_session(uuid,bytea,uuid)') is null
           and not exists (
             select 1
             from pg_catalog.pg_proc procedure
             join pg_catalog.pg_namespace namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'app_private'
               and procedure.proname in (
                 'require_session_digest',
                 'require_session_request_id',
                 'create_app_session',
                 'use_app_session',
                 'logout_app_session',
                 'revoke_app_session',
                 'revoke_principal_sessions',
                 'consume_login_throttle_dimension',
                 'consume_login_attempt',
                 'clear_login_account_throttle',
                 'cleanup_app_sessions'
               )
           )
           and not exists (
             select 1
             from pg_catalog.pg_proc procedure
             join pg_catalog.pg_namespace namespace
               on namespace.oid = procedure.pronamespace
             where namespace.nspname = 'public'
               and procedure.proname in (
                 'create_app_session',
                 'use_app_session',
                 'logout_app_session',
                 'revoke_app_session',
                 'revoke_principal_sessions',
                 'consume_login_attempt',
                 'clear_login_account_throttle'
               )
           )
           and pg_get_function_result(
             'public.cleanup_app_sessions(integer,uuid)'::regprocedure
           ) = 'text'
           and has_function_privilege(
             'public',
             'public.cleanup_app_sessions(integer,uuid)',
             'execute'
           )
           and exists (
             select 1
             from app_private.audit_event
             where action = 'migration.session_sentinel'
               and metadata = '{"source":"018"}'::jsonb
           )
           and not exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '019\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
  ) {
    throw new Error('failed session migration left partial schema or ledger state')
  }
  dockerPsql(sessionFailureDatabase, [
    '-q',
    '-c',
    'drop function public.cleanup_app_sessions(integer, uuid)',
  ])
  runMigration(sessionFailureDatabase)
  assertSessionFoundationsEmpty(sessionFailureDatabase)
  if (
    dockerPsql(
      sessionFailureDatabase,
      [
        '-At',
        '-c',
        `select
           pg_get_function_result(
             'public.cleanup_app_sessions(integer,uuid)'::regprocedure
           ) = 'jsonb'
           and exists (
             select 1
             from app_private.audit_event
             where action = 'migration.session_sentinel'
               and metadata = '{"source":"018"}'::jsonb
           )
           and exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '019\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
  ) {
    throw new Error('session migration did not recover after the conflict was removed')
  }

  // Exercise the supported 018 -> 019 production upgrade separately from the
  // legacy 012 adoption path. Existing identity and audit bytes must survive,
  // and additive session state must remain empty across both apply and replay.
  runMigration(sessionUpgradeDatabase, 'expand', { maxVersion: '018' })
  dockerPsql(
    sessionUpgradeDatabase,
    ['-q', '-f', '-'],
    `insert into app_private.principal (id, status)
       values ('01900000-0000-4000-8000-000000000002', 'active');
     insert into app_private.principal_identity (
       principal_id, provider, issuer, subject
     ) values (
       '01900000-0000-4000-8000-000000000002',
       'migration_test',
       'https://issuer.example/session-upgrade',
       'subject-${suffix}'
     );
     insert into app_private.audit_event (
       actor_type, action, entity_type, entity_id, metadata
     ) values (
       'system',
       'migration.session_upgrade',
       'principal',
       '01900000-0000-4000-8000-000000000002',
       '{"preserve":true}'::jsonb
     );`,
  )
  const sessionUpgradeSentinel = dockerPsql(sessionUpgradeDatabase, [
    '-At',
    '-c',
    `select jsonb_build_object(
       'principal', (select to_jsonb(principal.*) from app_private.principal principal),
       'identity', (select to_jsonb(identity.*) from app_private.principal_identity identity),
       'audit', (
         select to_jsonb(audit.*)
         from app_private.audit_event audit
         where audit.action = 'migration.session_upgrade'
       )
     )::text`,
  ])
  runMigration(sessionUpgradeDatabase, 'expand', { maxVersion: '019' })
  assertSessionFoundationsEmpty(sessionUpgradeDatabase)
  const upgradedSessionSentinel = dockerPsql(sessionUpgradeDatabase, [
    '-At',
    '-c',
    `select jsonb_build_object(
       'principal', (select to_jsonb(principal.*) from app_private.principal principal),
       'identity', (select to_jsonb(identity.*) from app_private.principal_identity identity),
       'audit', (
         select to_jsonb(audit.*)
         from app_private.audit_event audit
         where audit.action = 'migration.session_upgrade'
       )
     )::text`,
  ])
  if (upgradedSessionSentinel !== sessionUpgradeSentinel) {
    throw new Error('018-to-019 upgrade changed identity or audit sentinel data')
  }
  runMigration(sessionUpgradeDatabase, 'expand', { maxVersion: '019' })
  assertSessionFoundationsEmpty(sessionUpgradeDatabase)
  const replayedSessionSentinel = dockerPsql(sessionUpgradeDatabase, [
    '-At',
    '-c',
    `select jsonb_build_object(
       'principal', (select to_jsonb(principal.*) from app_private.principal principal),
       'identity', (select to_jsonb(identity.*) from app_private.principal_identity identity),
       'audit', (
         select to_jsonb(audit.*)
         from app_private.audit_event audit
         where audit.action = 'migration.session_upgrade'
       )
     )::text`,
  ])
  if (replayedSessionSentinel !== sessionUpgradeSentinel) {
    throw new Error('019 replay changed identity or audit sentinel data')
  }
  if (
    ledgerCount(sessionUpgradeDatabase, 'expand') !==
      sessionFoundationMigrationCount
  ) {
    throw new Error('018-to-019 replay produced an incomplete migration ledger')
  }

  // Exercise the supported 019 -> 020 production upgrade with both a late
  // wrapper collision and a populated 019 state. The failed runner must leave
  // the administrator bridge, session/token rows, audit bytes, conflicting
  // wrapper, and 019 ledger untouched while rolling back every earlier 020
  // object and its ledger insert. Removing only the conflict must then allow a
  // clean apply and replay without changing the sentinels.
  runMigration(admissionUpgradeDatabase, 'expand', { maxVersion: '019' })
  dockerPsql(
    admissionUpgradeDatabase,
    ['-q', '-f', '-'],
    `insert into app_private.principal (id, status)
       values ('02000000-0000-4000-8000-000000000001', 'active');
     insert into app_private.principal_identity (
       principal_id, provider, issuer, subject
     ) values (
       '02000000-0000-4000-8000-000000000001',
       'migration_test',
       'https://issuer.example/admission-upgrade',
       'AdmissionMigrationAdmin-${suffix}'
     );
     insert into public.admin_user (user_id, note, principal_id)
     values (
       'AdmissionMigrationAdmin-${suffix}',
       '019-to-020 administrator sentinel',
       '02000000-0000-4000-8000-000000000001'
     );
     set request.jwt.claims = '{"role":"service_role"}';
     select public.create_app_session(
       '02000000-0000-4000-8000-000000000001',
       pg_catalog.sha256(
         pg_catalog.convert_to('019-to-020-session-${suffix}', 'UTF8')
       ),
       '02002000-0000-4000-8000-000000000001'
     );
     insert into app_private.audit_event (
       actor_type, action, entity_type, entity_id, metadata
     ) values (
       'system',
       'migration.admission_upgrade',
       'principal',
       '02000000-0000-4000-8000-000000000001',
       '{"source":"019"}'::jsonb
     );`,
  )
  const admissionUpgradeSentinel = applicationAdmissionSentinel(
    admissionUpgradeDatabase,
  )

  dockerPsql(
    admissionUpgradeDatabase,
    ['-q', '-f', '-'],
    `create function public.authorize_admin_principal(uuid)
     returns text
     language sql
     immutable
     set search_path = pg_catalog
     as 'select ''preexisting''::text';`,
  )
  const admissionFailure = runMigration(admissionUpgradeDatabase, 'expand', {
    expectFailure: true,
  })
  if (
    !admissionFailure.includes('already exists with same argument types')
    && !admissionFailure.includes('cannot change return type of existing function')
  ) {
    throw new Error(
      `application-session admission conflict did not report the late wrapper collision: ${admissionFailure}`,
    )
  }
  if (
    dockerPsql(
      admissionUpgradeDatabase,
      [
        '-At',
        '-c',
        `select
           to_regprocedure(
             'app_private.admit_admin_app_session(text,text,text,bytea,uuid)'
           ) is null
           and to_regprocedure(
             'app_private.authorize_admin_principal(uuid)'
           ) is null
           and to_regprocedure(
             'public.admit_admin_app_session(text,text,text,bytea,uuid)'
           ) is null
           and pg_get_function_result(
             'public.authorize_admin_principal(uuid)'::regprocedure
           ) = 'text'
           and public.authorize_admin_principal(
             '02000000-0000-4000-8000-000000000001'
           ) = 'preexisting'
           and has_function_privilege(
             'public',
             'public.authorize_admin_principal(uuid)',
             'execute'
           )
           and to_regprocedure(
             'public.create_app_session(uuid,bytea,uuid)'
           ) is not null
           and exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '019\\_%' escape '\\'
           )
           and not exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '020\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
    || applicationAdmissionSentinel(admissionUpgradeDatabase) !==
      admissionUpgradeSentinel
  ) {
    throw new Error(
      'failed application-session admission migration changed 019 state, conflict, or ledger',
    )
  }

  dockerPsql(admissionUpgradeDatabase, [
    '-q',
    '-c',
    'drop function public.authorize_admin_principal(uuid)',
  ])
  runMigration(admissionUpgradeDatabase)
  if (
    dockerPsql(
      admissionUpgradeDatabase,
      [
        '-At',
        '-c',
        `select
           to_regprocedure(
             'app_private.admit_admin_app_session(text,text,text,bytea,uuid)'
           ) is not null
           and to_regprocedure(
             'app_private.authorize_admin_principal(uuid)'
           ) is not null
           and to_regprocedure(
             'public.admit_admin_app_session(text,text,text,bytea,uuid)'
           ) is not null
           and pg_get_function_result(
             'public.authorize_admin_principal(uuid)'::regprocedure
           ) = 'jsonb'
           and exists (
             select 1
             from public.schema_migration
             where phase = 'expand'
               and filename like '020\\_%' escape '\\'
           )`,
      ],
    ) !== 't'
    || applicationAdmissionSentinel(admissionUpgradeDatabase) !==
      admissionUpgradeSentinel
  ) {
    throw new Error(
      '019-to-020 upgrade did not recover cleanly or preserve its sentinels',
    )
  }

  runMigration(admissionUpgradeDatabase)
  if (
    ledgerCount(admissionUpgradeDatabase, 'expand') !== expandMigrationCount
    || applicationAdmissionSentinel(admissionUpgradeDatabase) !==
      admissionUpgradeSentinel
  ) {
    throw new Error('020 replay changed 019 state or produced an incomplete ledger')
  }

  dockerPsql(upgradeDatabase, ['--single-transaction', '-q', '-f', '-'], legacySql)

  const sentinelDescription = `maintainer-owned-description-${suffix}`
  const sentinelFormat = `maintainer-owned-format-${suffix}`
  const sentinelAdminSubject = `maintainer-owned-admin-${suffix}`
  dockerPsql(
    upgradeDatabase,
    [
      '-q',
      '-c',
      `update public.game
       set description='${sentinelDescription}', format_note='${sentinelFormat}'
       where slug='cs2'`,
    ],
  )
  dockerPsql(
    upgradeDatabase,
    [
      '-q',
      '-c',
      `insert into public.admin_user (user_id, note)
       values ('${sentinelAdminSubject}', 'identity no-backfill sentinel')`,
    ],
  )

  const refusal = runMigration(upgradeDatabase, 'expand', { expectFailure: true })
  if (!refusal.includes('Existing unledgered schema detected')) {
    throw new Error('unledgered legacy schema did not fail with adoption guidance')
  }
  if (
    dockerPsql(
      upgradeDatabase,
      ['-At', '-c', `select to_regclass('public.schema_migration') is null`],
    ) !== 't'
  ) {
    throw new Error('refused legacy migration wrote a ledger before explicit adoption')
  }

  runMigration(upgradeDatabase, 'expand', { baseline: true })
  const sentinel = dockerPsql(
    upgradeDatabase,
    [
      '-At',
      '-F',
      '\t',
      '-c',
      `select description, format_note from public.game where slug='cs2'`,
    ],
  )
  if (sentinel !== `${sentinelDescription}\t${sentinelFormat}`) {
    throw new Error('baseline adoption replayed historical seed data')
  }
  assertIdentityFoundationsEmpty(upgradeDatabase)
  assertSessionFoundationsEmpty(upgradeDatabase)
  if (
    dockerPsql(
      upgradeDatabase,
      [
        '-At',
        '-c',
        `select count(*)
         from public.admin_user
         where user_id = '${sentinelAdminSubject}'
           and principal_id is null`,
      ],
    ) !== '1'
  ) {
    throw new Error('identity migration changed or removed the legacy admin sentinel')
  }
  assertLifecycle(upgradeDatabase, 'expanded')
  assertRpcClaims(upgradeDatabase, 'expanded')
  if (ledgerCount(upgradeDatabase, 'expand') !== expandMigrationCount) {
    throw new Error('main-to-head upgrade did not ledger all expand migrations')
  }

  // A second run must verify checksums and skip every recorded migration.
  runMigration(upgradeDatabase)
  assertSessionFoundationsEmpty(upgradeDatabase)
  assertLifecycle(upgradeDatabase, 'expanded')
  runMigration(upgradeDatabase, 'contract')
  assertLifecycle(upgradeDatabase, 'contracted')
  assertRpcClaims(upgradeDatabase, 'contracted')
  runMigration(upgradeDatabase)
  assertLifecycle(upgradeDatabase, 'contracted')

  const rollbackSql = readFileSync(
    join(ROOT, 'migrations', 'rollback', '017_restore_registration_compatibility.sql'),
    'utf8',
  )
  // The rollback file owns its transaction so the documented direct execution
  // path cannot expose compatibility ACLs without clearing its ledger record.
  dockerPsql(upgradeDatabase, ['-q', '-f', '-'], rollbackSql)
  assertLifecycle(upgradeDatabase, 'expanded')
  assertRpcClaims(upgradeDatabase, 'expanded')
  if (ledgerCount(upgradeDatabase, 'contract') !== 0) {
    throw new Error('rollback did not clear its exact contract ledger entry')
  }
  runMigration(upgradeDatabase, 'contract')
  assertLifecycle(upgradeDatabase, 'contracted')
  assertRpcClaims(upgradeDatabase, 'contracted')

  // Contract preflight must be all-or-nothing when a later expand version is
  // missing. This prevents 014 from contracting before 017 can safely remove
  // the legacy public endpoints.
  runMigration(contractDatabase, 'expand', { maxVersion: '016' })
  const expand014Filename = migrationFiles('').find(filename => filename.startsWith('014_'))
  if (!expand014Filename) throw new Error('expand migration 014 is missing from the repository')
  const expand014Checksum = migrationChecksum(
    readFileSync(join(ROOT, 'migrations', expand014Filename), 'utf8'),
  )
  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `update public.schema_migration
       set checksum='tampered-expand-checksum'
       where phase='expand' and filename='${expand014Filename}'`,
    ],
  )
  const tamperedExpandRefusal = runMigration(contractDatabase, 'contract', {
    expectFailure: true,
  })
  if (!tamperedExpandRefusal.includes(`expand/${expand014Filename} has changed`)) {
    throw new Error('contract runner did not validate the applied expand checksum')
  }
  if (ledgerCount(contractDatabase, 'contract') !== 0) {
    throw new Error('tampered expand preflight partially applied a contraction')
  }
  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `update public.schema_migration
       set checksum='${expand014Checksum}'
       where phase='expand' and filename='${expand014Filename}'`,
    ],
  )
  const dependencyRefusal = runMigration(contractDatabase, 'contract', {
    expectFailure: true,
  })
  if (!dependencyRefusal.includes('corresponding expand version first')) {
    throw new Error('contract dependency refusal did not explain the missing expand version')
  }
  if (ledgerCount(contractDatabase, 'contract') !== 0) {
    throw new Error('contract dependency preflight partially applied an earlier contraction')
  }

  // Reproduce the historical rollout order: 014 was already contracted before
  // migrations 015-017 existed. Expanding 017 must preserve that contracted
  // state, and its own contract ledger can then be recorded safely.
  runMigration(contractDatabase, 'contract', { maxVersion: '014' })

  const contract014Filename = migrationFiles('post-deploy').find(filename =>
    filename.startsWith('014_'),
  )
  if (!contract014Filename) {
    throw new Error('contract migration 014 is missing from the repository')
  }
  const contract014Checksum = migrationChecksum(
    readFileSync(
      join(ROOT, 'migrations', 'post-deploy', contract014Filename),
      'utf8',
    ),
  )
  const expandCountBeforeContractTamper = ledgerCount(contractDatabase, 'expand')
  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `update public.schema_migration
       set checksum='tampered-contract-checksum'
       where phase='contract' and filename='${contract014Filename}'`,
    ],
  )
  const tamperedContractRefusal = runMigration(contractDatabase, 'expand', {
    expectFailure: true,
  })
  if (!tamperedContractRefusal.includes(`contract/${contract014Filename} has changed`)) {
    throw new Error('expand runner did not validate the applied contract checksum')
  }
  if (
    ledgerCount(contractDatabase, 'expand') !== expandCountBeforeContractTamper
    || dockerPsql(
      contractDatabase,
      [
        '-At',
        '-c',
        `select
           to_regprocedure('public.submit_team(jsonb)') is not null
           and to_regprocedure(
             'public.recent_registration_attempts(text,integer)'
           ) is not null`,
      ],
    ) !== 't'
  ) {
    throw new Error('tampered contract preflight changed expand state or endpoints')
  }
  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `update public.schema_migration
       set checksum='${contract014Checksum}'
       where phase='contract' and filename='${contract014Filename}'`,
    ],
  )
  runMigration(contractDatabase, 'expand')

  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `insert into public.schema_migration (phase, filename, checksum)
       values ('expand', '009_removed_historical_migration.sql', 'removed')`,
    ],
  )
  const removedMigrationRefusal = runMigration(contractDatabase, 'expand', {
    expectFailure: true,
  })
  if (!removedMigrationRefusal.includes('is missing from the repository')) {
    throw new Error('runner accepted a ledgered migration missing from the repository')
  }
  dockerPsql(
    contractDatabase,
    [
      '-q',
      '-c',
      `delete from public.schema_migration
       where phase='expand' and filename='009_removed_historical_migration.sql'`,
    ],
  )
  assertLifecycle(contractDatabase, 'contracted')
  assertRpcClaims(contractDatabase, 'contracted')
  if (ledgerCount(contractDatabase, 'contract') !== 1) {
    throw new Error('historical 014 contraction was not preserved through 017 expand')
  }
  dockerPsql(contractDatabase, ['-q', '-f', '-'], rollbackSql)
  assertLifecycle(contractDatabase, 'expanded')
  assertRpcClaims(contractDatabase, 'expanded')

  // Reproduce an interrupted rollout with only 014 contracted. The 017 SQL
  // guard must reject an incomplete private core without dropping either
  // legacy endpoint, and the coordinated rollback must be idempotent while
  // those wrappers still exist.
  runMigration(contractDatabase, 'contract', { maxVersion: '014' })
  dockerPsql(
    contractDatabase,
    ['-q', '-c', `alter function app_private.submit_team(jsonb) rename to submit_team_unavailable`],
  )
  const unsafeContractRefusal = runMigration(contractDatabase, 'contract', {
    expectFailure: true,
  })
  if (!unsafeContractRefusal.includes('private registration implementation is missing')) {
    throw new Error('017 contract accepted an incomplete private registration core')
  }
  if (
    ledgerCount(contractDatabase, 'contract') !== 1
    || dockerPsql(
      contractDatabase,
      [
        '-At',
        '-c',
        `select
           to_regprocedure('public.submit_team(jsonb)') is not null
           and to_regprocedure(
             'public.recent_registration_attempts(text,integer)'
           ) is not null`,
      ],
    ) !== 't'
  ) {
    throw new Error('failed 017 contraction changed endpoints or its ledger')
  }
  const unsafeRollbackRefusal = dockerPsqlFailure(
    contractDatabase,
    ['-q', '-f', '-'],
    rollbackSql,
  )
  if (!unsafeRollbackRefusal.includes('private registration core is incomplete')) {
    throw new Error('rollback did not explain the missing private registration core')
  }
  if (ledgerCount(contractDatabase, 'contract') !== 1) {
    throw new Error('unsafe rollback cleared a contract ledger row')
  }
  dockerPsql(
    contractDatabase,
    ['-q', '-c', `alter function app_private.submit_team_unavailable(jsonb) rename to submit_team`],
  )
  dockerPsql(contractDatabase, ['-q', '-f', '-'], rollbackSql)
  assertLifecycle(contractDatabase, 'expanded')
  assertRpcClaims(contractDatabase, 'expanded')
  if (ledgerCount(contractDatabase, 'contract') !== 0) {
    throw new Error('partial-contract rollback did not clear the 014 ledger entry')
  }
  runMigration(contractDatabase, 'contract')
  assertLifecycle(contractDatabase, 'contracted')
  assertRpcClaims(contractDatabase, 'contracted')

  runMigration(freshDatabase)
  assertIdentityFoundationsEmpty(freshDatabase)
  assertSessionFoundationsEmpty(freshDatabase)
  assertLifecycle(freshDatabase, 'expanded')
  assertRpcClaims(freshDatabase, 'expanded')
  runMigration(freshDatabase, 'contract')
  assertLifecycle(freshDatabase, 'contracted')
  assertRpcClaims(freshDatabase, 'contracted')

  if (
    ledgerCount(freshDatabase, 'expand') !== expandMigrationCount ||
    ledgerCount(freshDatabase, 'contract') !== contractMigrationCount
  ) {
    throw new Error('fresh install migration ledger is incomplete')
  }

  const contract014 = migrationFiles('post-deploy').find(filename =>
    filename.startsWith('014_'),
  )
  if (!contract014) throw new Error('contract migration 014 is missing')
  const contract014CurrentChecksum = migrationChecksum(
    readFileSync(join(ROOT, 'migrations', 'post-deploy', contract014), 'utf8'),
  )
  dockerPsql(
    freshDatabase,
    [
      '-q',
      '-c',
      `delete from public.schema_migration
       where phase='contract' and filename='${contract014}'`,
    ],
  )
  const historyGapRefusal = runMigration(freshDatabase, 'contract', {
    expectFailure: true,
  })
  if (!historyGapRefusal.includes('migration histories are append-only')) {
    throw new Error('contract runner accepted a backfilled history gap')
  }
  if (ledgerCount(freshDatabase, 'contract') !== contractMigrationCount - 1) {
    throw new Error('append-only refusal wrote a contract ledger row')
  }
  dockerPsql(
    freshDatabase,
    [
      '-q',
      '-c',
      `insert into public.schema_migration (phase, filename, checksum)
       values ('contract', '${contract014}', '${contract014CurrentChecksum}')`,
    ],
  )

  runMigration(concurrentDatabase, 'expand', { maxVersion: '018' })
  const migrationBarrier = await acquireMigrationTestBarrier(concurrentDatabase)
  const concurrentRunners = [
    startMigrationRunner(concurrentDatabase),
    startMigrationRunner(concurrentDatabase),
  ]
  let concurrentResults
  try {
    await proveMigrationRunnersBlocked(
      concurrentDatabase,
      migrationBarrier,
      concurrentRunners,
    )
  } finally {
    await releaseMigrationTestBarrier(migrationBarrier)
    concurrentResults = await Promise.all(
      concurrentRunners.map(runner => runner.completion),
    )
  }
  for (const result of concurrentResults) {
    process.stdout.write(result.output)
    if (result.code !== 0) {
      throw new Error('concurrent migration runner failed instead of serializing')
    }
  }
  if (ledgerCount(concurrentDatabase, 'expand') !== expandMigrationCount) {
    throw new Error('concurrent migration runners produced an incomplete ledger')
  }
  assertSessionFoundationsEmpty(concurrentDatabase)

  if (externalPsqlAvailable) {
    runMigration(externalDatabase, 'expand', { external: true })
    assertSessionFoundationsEmpty(externalDatabase)
    assertLifecycle(externalDatabase, 'expanded')
    assertRpcClaims(externalDatabase, 'expanded')
    runMigration(externalDatabase, 'contract', { external: true })
    assertLifecycle(externalDatabase, 'contracted')
    assertRpcClaims(externalDatabase, 'contracted')
    console.log('external psql migration target test passed')
  } else {
    console.log('external psql migration target test skipped (psql unavailable)')
  }

  console.log('migration adoption, fresh-install, replay, and contraction tests passed')
} finally {
  for (const database of databases) {
    dockerPsql('postgres', ['-q', '-c', `drop database if exists ${database} with (force)`])
  }
}
