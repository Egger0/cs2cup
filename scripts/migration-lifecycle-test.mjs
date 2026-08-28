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
const contractDatabase = `cs2cup_migration_contract_${suffix}`
const externalDatabase = `cs2cup_migration_external_${suffix}`
const concurrentDatabase = `cs2cup_migration_concurrent_${suffix}`
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
  contractDatabase,
  concurrentDatabase,
  ...(externalPsqlAvailable ? [externalDatabase] : []),
]
const migrationFiles = directory =>
  readdirSync(join(ROOT, 'migrations', directory))
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
const expandMigrationCount = migrationFiles('').length
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

function runMigrationAsync(database) {
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
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolve({ code, output }))
  })
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

  dockerPsql(upgradeDatabase, ['--single-transaction', '-q', '-f', '-'], legacySql)

  const sentinelDescription = `maintainer-owned-description-${suffix}`
  const sentinelFormat = `maintainer-owned-format-${suffix}`
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
  assertLifecycle(upgradeDatabase, 'expanded')
  assertRpcClaims(upgradeDatabase, 'expanded')
  if (ledgerCount(upgradeDatabase, 'expand') !== expandMigrationCount) {
    throw new Error('main-to-head upgrade did not ledger all expand migrations')
  }

  // A second run must verify checksums and skip every recorded migration.
  runMigration(upgradeDatabase)
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

  const concurrentResults = await Promise.all([
    runMigrationAsync(concurrentDatabase),
    runMigrationAsync(concurrentDatabase),
  ])
  for (const result of concurrentResults) {
    process.stdout.write(result.output)
    if (result.code !== 0) {
      throw new Error('concurrent migration runner failed instead of serializing')
    }
  }
  if (ledgerCount(concurrentDatabase, 'expand') !== expandMigrationCount) {
    throw new Error('concurrent migration runners produced an incomplete ledger')
  }

  if (externalPsqlAvailable) {
    runMigration(externalDatabase, 'expand', { external: true })
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
