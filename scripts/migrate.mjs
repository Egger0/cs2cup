import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { migrationChecksum } from './migration-checksum.mjs'
import {
  verifyAppendOnlyMigrations,
  verifyUniqueMigrationVersions,
} from './migration-state.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MIGRATION_LOCK_CLASS_ID = 1129521731
const MIGRATION_LOCK_OBJECT_ID = 1296647246
const phaseIndex = process.argv.indexOf('--phase')
const phase = phaseIndex === -1 ? 'expand' : process.argv[phaseIndex + 1]
if (phase !== 'expand' && phase !== 'contract') {
  throw new Error('Migration phase must be expand or contract')
}

const baselineIndex = process.argv.indexOf('--baseline')
const baseline = baselineIndex === -1 ? undefined : process.argv[baselineIndex + 1]
if (baseline !== undefined && baseline !== '012') {
  throw new Error('The only supported legacy baseline is 012')
}
if (baseline && phase !== 'expand') {
  throw new Error('--baseline is available only for expand migrations')
}

const database = process.env.MIGRATION_DB_NAME ?? 'cs2cup'
const databaseUrl = process.env.MIGRATION_DATABASE_URL
const expectedDatabase = databaseUrl
  ? process.env.MIGRATION_EXPECT_DATABASE
  : database
if (!expectedDatabase || !/^[a-zA-Z0-9_]+$/.test(expectedDatabase)) {
  throw new Error(
    databaseUrl
      ? 'MIGRATION_EXPECT_DATABASE is required and must contain only letters, digits and underscores'
      : 'MIGRATION_DB_NAME must contain only letters, digits and underscores',
  )
}
if (!databaseUrl && !/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('MIGRATION_DB_NAME must contain only letters, digits and underscores')
}

function directPsqlEnvironment() {
  if (!databaseUrl) return process.env

  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('MIGRATION_DATABASE_URL must use postgres:// or postgresql://')
  }

  const urlDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!urlDatabase || urlDatabase.includes('/')) {
    throw new Error('MIGRATION_DATABASE_URL must include exactly one database name')
  }
  if (urlDatabase !== expectedDatabase) {
    throw new Error(
      `MIGRATION_DATABASE_URL names ${urlDatabase}, expected ${expectedDatabase}`,
    )
  }

  const environment = { ...process.env }
  // libpq has many PG* inputs, including PGHOSTADDR and service files that can
  // override a URL-derived host. Start from a closed set so inherited shell or
  // CI configuration cannot redirect this migration to a same-named database.
  for (const name of Object.keys(environment)) {
    if (name.startsWith('PG')) delete environment[name]
  }

  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (!host || !url.username) {
    throw new Error('MIGRATION_DATABASE_URL must include a host and user')
  }
  Object.assign(environment, {
    PGHOST: host,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: urlDatabase,
    PGAPPNAME: 'cs2cup-migrations',
  })

  const parameterMap = {
    sslmode: 'PGSSLMODE',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    sslrootcert: 'PGSSLROOTCERT',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME',
    options: 'PGOPTIONS',
    channel_binding: 'PGCHANNELBINDING',
    target_session_attrs: 'PGTARGETSESSIONATTRS',
  }
  for (const [name, value] of url.searchParams) {
    const environmentName = parameterMap[name]
    if (!environmentName) {
      throw new Error(`Unsupported MIGRATION_DATABASE_URL parameter: ${name}`)
    }
    environment[environmentName] = value
  }
  return environment
}

const psqlEnvironment = directPsqlEnvironment()

const maxVersion = process.env.MIGRATION_TEST_MAX_VERSION
const testControlsEnabled = process.env.MIGRATION_ENABLE_TEST_CONTROLS === '1'
if (maxVersion !== undefined && (!testControlsEnabled || process.env.NODE_ENV === 'production')) {
  throw new Error(
    'MIGRATION_TEST_MAX_VERSION requires MIGRATION_ENABLE_TEST_CONTROLS=1 outside production',
  )
}
if (testControlsEnabled && maxVersion === undefined) {
  throw new Error('MIGRATION_ENABLE_TEST_CONTROLS is valid only with MIGRATION_TEST_MAX_VERSION')
}
if (maxVersion !== undefined && !/^\d{3}$/.test(maxVersion)) {
  throw new Error('MIGRATION_TEST_MAX_VERSION must be a three-digit migration number')
}
if (baseline && maxVersion) {
  throw new Error('--baseline cannot be combined with test migration controls')
}

const directory = join(ROOT, 'migrations', phase === 'contract' ? 'post-deploy' : '')
const repositoryFiles = (await readdir(directory))
  .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
  .sort()
const otherPhase = phase === 'expand' ? 'contract' : 'expand'
const otherDirectory = join(
  ROOT,
  'migrations',
  otherPhase === 'contract' ? 'post-deploy' : '',
)
const otherFiles = (await readdir(otherDirectory))
  .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
  .sort()
verifyUniqueMigrationVersions(phase, repositoryFiles)
verifyUniqueMigrationVersions(otherPhase, otherFiles)

const files = repositoryFiles
  .filter(file => !maxVersion || file.slice(0, 3) <= maxVersion)

if (files.length === 0) throw new Error(`No ${phase} migrations found`)

function psqlInvocation(args) {
  const command = databaseUrl ? (process.env.MIGRATION_PSQL_BIN ?? 'psql') : 'docker'
  const commandArgs = databaseUrl
    ? ['-X', '-v', 'ON_ERROR_STOP=1', ...args]
    : [
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
    ]
  return { command, commandArgs }
}

let migrationLock = null

function psql(args, input) {
  if (
    migrationLock
    && (migrationLock.child.exitCode !== null || migrationLock.child.signalCode !== null)
  ) {
    throw new Error('Migration advisory-lock session exited unexpectedly')
  }
  const { command, commandArgs } = psqlInvocation(args)
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: psqlEnvironment,
  })

  if (result.error) {
    throw new Error(`Unable to start ${databaseUrl ? 'psql' : 'Docker'}: ${result.error.message}`)
  }
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`psql failed with exit code ${result.status}`)
  }
  return result.stdout.trim()
}

async function acquireMigrationLock() {
  const marker = 'CS2CUP_MIGRATION_LOCK_ACQUIRED'
  const { command, commandArgs } = psqlInvocation(['-q', '-At'])
  const child = spawn(command, commandArgs, {
    cwd: ROOT,
    env: psqlEnvironment,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
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
    const finish = callback => value => {
      if (settled) return
      settled = true
      callback(value)
    }
    const succeed = finish(resolve)
    const fail = finish(reject)

    child.stdout.on('data', () => {
      if (stdout.includes(marker)) succeed()
    })
    child.once('error', error => fail(error))
    child.once('exit', code => {
      fail(
        new Error(
          `Migration advisory-lock session exited with ${code ?? 'unknown status'}${stderr ? `\n${stderr.trim()}` : ''}`,
        ),
      )
    })
  })

  child.stdin.write(
    `set statement_timeout = '60s';\n` +
      `select pg_catalog.pg_advisory_lock(${MIGRATION_LOCK_CLASS_ID}, ${MIGRATION_LOCK_OBJECT_ID});\n` +
      `reset statement_timeout;\n` +
      `select '${marker}';\n`,
  )

  try {
    await acquired
  } catch (error) {
    child.stdin.destroy()
    child.kill('SIGTERM')
    throw error
  }
  return { child, stderr: () => stderr }
}

async function releaseMigrationLock(lock) {
  const exited = new Promise(resolve => lock.child.once('exit', resolve))
  if (lock.child.exitCode !== null || lock.child.signalCode !== null) return
  // Session-level advisory locks are released by PostgreSQL when this
  // dedicated connection closes. The Docker CLI does not reliably forward a
  // graceful signal to an idle `compose exec`, so close this single-purpose
  // client immediately after the phase completes.
  lock.child.stdin.destroy()
  lock.child.kill('SIGKILL')
  await exited
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const connectedDatabase = psql(['-At', '-c', 'select current_database()'])
if (connectedDatabase !== expectedDatabase) {
  throw new Error(
    `Migration target is ${connectedDatabase || '(unknown)'}, expected ${expectedDatabase}`,
  )
}

migrationLock = await acquireMigrationLock()

try {

const createLedgerSql = `
  create table public.schema_migration (
     phase text not null check (phase in ('expand', 'contract')),
     filename text not null,
     checksum text not null,
     applied_at timestamptz not null default now(),
     primary key (phase, filename)
  );
  revoke all on public.schema_migration from public;
`

const ledgerExists = psql([
  '-At',
  '-c',
  `select to_regclass('public.schema_migration') is not null`,
]) === 't'
const applicationSchemaExists = psql([
  '-At',
  '-c',
  `select
    to_regclass('public.site_setting') is not null
    or to_regclass('public.game') is not null
    or to_regclass('public.tournament') is not null
    or to_regclass('public.team') is not null
    or to_regclass('public.player') is not null
    or to_regclass('public.match') is not null
    or to_regclass('public.photo') is not null
    or to_regclass('public.admin_user') is not null
    or to_regclass('public.registration_attempt') is not null
    or to_regclass('public.match_map') is not null
    or to_regclass('public.club_member') is not null
    or to_regclass('public.post') is not null
    or to_regclass('public.team_public') is not null
    or to_regclass('public.player_public') is not null
    or to_regclass('public.match_map_public') is not null
    or to_regprocedure('public.submit_team(jsonb)') is not null
    or to_regprocedure('public.registration_status(text)') is not null`,
]) === 't'

const baselineCompatibilityExpression = `
  to_regclass('public.site_setting') is not null
  and to_regclass('public.game') is not null
  and to_regclass('public.tournament') is not null
  and to_regclass('public.team') is not null
  and to_regclass('public.player') is not null
  and to_regclass('public.match') is not null
  and to_regclass('public.photo') is not null
  and to_regclass('public.admin_user') is not null
  and to_regclass('public.registration_attempt') is not null
  and to_regclass('public.match_map') is not null
  and to_regclass('public.club_member') is not null
  and to_regclass('public.post') is not null
  and to_regclass('public.team_public') is not null
  and to_regclass('public.player_public') is not null
  and to_regclass('public.match_map_public') is not null
  and to_regprocedure('public.submit_team(jsonb)') is not null
  and to_regprocedure('public.registration_status(text)') is not null
  and to_regprocedure('public.recent_registration_attempts(text,integer)') is not null
  and to_regprocedure('public.set_team_seed(bigint,bigint,integer)') is not null
  and to_regprocedure('public.replace_bracket(bigint,bigint[],integer[])') is not null
  and to_regprocedure(
    'public.save_match_score(bigint,bigint,bigint,integer,integer)'
  ) is not null
  and to_regprocedure('public.save_match_report(bigint,bigint,bigint,jsonb)') is not null
  and to_regprocedure(
    'public.replace_match_schedule(bigint,bigint[],timestamp with time zone[],timestamp with time zone[])'
  ) is not null
  and to_regclass('public.photo_public') is null
  and to_regprocedure('public.submit_team_rate_limited(text,jsonb)') is null
  and not exists (
    select 1
    from (values
      ('site_setting'), ('game'), ('tournament'), ('team'), ('player'), ('match'),
      ('photo'), ('admin_user'), ('registration_attempt'), ('match_map'),
      ('club_member'), ('post')
    ) expected(relname)
    left join pg_catalog.pg_class relation
      on relation.relnamespace = 'public'::regnamespace
     and relation.relname = expected.relname
    where relation.oid is null or not relation.relrowsecurity
  )
  and exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
  and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
  and not exists (
    select 1
    from (values ('anon'), ('authenticated')) request_role(rolname)
    cross join (values
      ('team'), ('player'), ('admin_user'), ('registration_attempt')
    ) private_table(relname)
    cross join (values
      ('select'), ('insert'), ('update'), ('delete'), ('truncate'),
      ('references'), ('trigger')
    ) requested_privilege(privilege)
    where has_table_privilege(
      request_role.rolname,
      format('public.%I', private_table.relname),
      requested_privilege.privilege
    )
       or (
         requested_privilege.privilege in ('select', 'insert', 'update', 'references')
         and has_any_column_privilege(
           request_role.rolname,
           format('public.%I', private_table.relname),
           requested_privilege.privilege
         )
       )
  )
  and not exists (
    select 1
    from (values ('anon'), ('authenticated')) request_role(rolname)
    cross join (values
      ('public.submit_team(jsonb)'),
      ('public.recent_registration_attempts(text,integer)'),
      ('public.set_team_seed(bigint,bigint,integer)'),
      ('public.replace_bracket(bigint,bigint[],integer[])'),
      ('public.save_match_score(bigint,bigint,bigint,integer,integer)'),
      ('public.save_match_report(bigint,bigint,bigint,jsonb)'),
      ('public.replace_match_schedule(bigint,bigint[],timestamp with time zone[],timestamp with time zone[])')
    ) private_function(signature)
    where has_function_privilege(
      request_role.rolname,
      private_function.signature,
      'execute'
    )
  )
  and has_function_privilege('anon', 'public.registration_status(text)', 'execute')
  and has_function_privilege('authenticated', 'public.registration_status(text)', 'execute')
`

if (ledgerExists && baseline) {
  throw new Error('Cannot baseline a database that already has a migration ledger')
}

if (!ledgerExists) {
  if (phase === 'contract') {
    throw new Error('Expand migrations must initialize the ledger before contract migrations')
  }

  if (applicationSchemaExists && !baseline) {
    throw new Error(
      'Existing unledgered schema detected; verify it is main at migration 012, then run with --baseline 012',
    )
  }

  if (baseline) {
    const compatible = psql([
      '-At',
      '-c',
      `select ${baselineCompatibilityExpression}`,
    ]) === 't'

    if (!compatible) {
      throw new Error('Schema does not match the verified main/012 baseline; no ledger was written')
    }

    const baselineDirectory = join(ROOT, 'migrations')
    const baselineFiles = (await readdir(baselineDirectory))
      .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
      .filter(file => file.slice(0, 3) <= baseline)
      .sort()
    if (baselineFiles.length !== 12 || baselineFiles.at(-1)?.slice(0, 3) !== baseline) {
      throw new Error('Repository does not contain the complete 001-012 baseline')
    }

    const baselineRows = []
    for (const filename of baselineFiles) {
      const sql = await readFile(join(baselineDirectory, filename), 'utf8')
      const checksum = migrationChecksum(sql)
      baselineRows.push(
        `('expand', ${sqlString(filename)}, ${sqlString(checksum)})`,
      )
    }
    psql(
      ['--single-transaction', '-q', '-f', '-'],
      `lock table
         public.site_setting, public.game, public.tournament, public.team,
         public.player, public.match, public.photo, public.admin_user,
         public.registration_attempt, public.match_map, public.club_member,
         public.post
       in share mode;
       do $baseline$
       begin
         if to_regclass('public.schema_migration') is not null
           or not (${baselineCompatibilityExpression})
         then
           raise exception 'schema changed during baseline verification';
         end if;
       end
       $baseline$;
       ${createLedgerSql}
       insert into public.schema_migration (phase, filename, checksum) values
       ${baselineRows.join(',\n')};`,
    )
    for (const filename of baselineFiles) console.log(`baseline expand/${filename}`)
  } else {
    psql(['--single-transaction', '-q', '-f', '-'], createLedgerSql)
  }
}

function readAppliedMigrations(appliedPhase) {
  const rows = psql([
    '-At',
    '-F',
    '\t',
    '-c',
    `select filename, checksum
     from public.schema_migration
     where phase = ${sqlString(appliedPhase)}
     order by filename`,
  ])
  return new Map(rows ? rows.split('\n').map(row => row.split('\t', 2)) : [])
}

async function readRepositoryMigrations(migrationDirectory, filenames) {
  const migrations = new Map()
  const versions = new Map()
  for (const filename of filenames) {
    const sql = await readFile(join(migrationDirectory, filename), 'utf8')
    migrations.set(filename, { sql, checksum: migrationChecksum(sql) })
    const version = filename.slice(0, 3)
    const versionFiles = versions.get(version) ?? []
    versionFiles.push(filename)
    versions.set(version, versionFiles)
  }
  return { migrations, versions }
}

function verifyAppliedMigrations(appliedPhase, appliedMigrations, repositoryMigrations) {
  for (const [filename, checksum] of appliedMigrations) {
    const repositoryMigration = repositoryMigrations.get(filename)
    if (!repositoryMigration) {
      throw new Error(
        `Applied migration ${appliedPhase}/${filename} is missing from the repository`,
      )
    }
    if (repositoryMigration.checksum !== checksum) {
      throw new Error(
        `Applied migration ${appliedPhase}/${filename} has changed; add a new migration instead`,
      )
    }
  }
}

const repository = await readRepositoryMigrations(directory, repositoryFiles)
const applied = readAppliedMigrations(phase)
verifyAppliedMigrations(phase, applied, repository.migrations)
verifyAppendOnlyMigrations(phase, applied, repository.migrations)

const otherRepository = await readRepositoryMigrations(otherDirectory, otherFiles)
const otherApplied = readAppliedMigrations(otherPhase)
verifyAppliedMigrations(otherPhase, otherApplied, otherRepository.migrations)
verifyAppendOnlyMigrations(otherPhase, otherApplied, otherRepository.migrations)

if (phase === 'contract') {
  const expandRepository = otherRepository
  const appliedExpand = otherApplied

  const missingDependencies = []
  for (const filename of files) {
    const version = filename.slice(0, 3)
    const candidates = expandRepository.versions.get(version) ?? []
    if (candidates.length !== 1) {
      throw new Error(
        `Contract migration ${filename} requires exactly one repository expand migration at version ${version}`,
      )
    }
    const [expandFilename] = candidates
    if (!appliedExpand.has(expandFilename)) {
      missingDependencies.push(`${filename} -> ${expandFilename}`)
    }
  }
  if (missingDependencies.length > 0) {
    throw new Error(
      `Contract migrations require their corresponding expand version first: ${missingDependencies.join(', ')}`,
    )
  }
}

for (const filename of files) {
  const { sql, checksum } = repository.migrations.get(filename)
  const existing = applied.get(filename)

  if (existing) {
    console.log(`skip  ${phase}/${filename}`)
    continue
  }

  const ledgerInsert = `
insert into public.schema_migration (phase, filename, checksum)
values (${sqlString(phase)}, ${sqlString(filename)}, ${sqlString(checksum)});
`
  psql(['--single-transaction', '-q', '-f', '-'], `${sql}\n${ledgerInsert}`)
  console.log(`apply   ${phase}/${filename}`)
}
} finally {
  await releaseMigrationLock(migrationLock)
  migrationLock = null
}
