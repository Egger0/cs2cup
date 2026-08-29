import postgres from 'postgres'

import {
  ADMIN_PASSWORD_ALGORITHM,
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_PASSWORD_SALT_BYTES,
  bytesToHex,
  deriveAdminPasswordHash,
  normalizeAdminPassword,
  normalizeAdminUsername,
  parseAdminAuthPepper,
  randomBytes,
} from '../lib/admin-auth-crypto.ts'

const usernameIndex = process.argv.indexOf('--username')
const usernameValue = usernameIndex === -1 ? undefined : process.argv[usernameIndex + 1]
if (!usernameValue || process.argv.includes('--password') || !process.argv.includes('--password-stdin')) {
  throw new Error(
    'Usage: node scripts/admin-credential.mjs --username <name> --password-stdin',
  )
}
const username = normalizeAdminUsername(usernameValue)

if (process.env.ADMIN_CREDENTIAL_ALLOW_MUTATION !== '1') {
  throw new Error(
    'Set ADMIN_CREDENTIAL_ALLOW_MUTATION=1 only after verifying the target database',
  )
}

const connectionString = process.env.MIGRATION_DATABASE_URL
const expectedDatabase = process.env.MIGRATION_EXPECT_DATABASE
if (!connectionString || !expectedDatabase || !/^[a-zA-Z0-9_]+$/.test(expectedDatabase)) {
  throw new Error(
    'MIGRATION_DATABASE_URL and a safe MIGRATION_EXPECT_DATABASE are required',
  )
}

let target
try {
  target = new URL(connectionString)
} catch {
  throw new Error('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL')
}
if (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:') {
  throw new Error('MIGRATION_DATABASE_URL must use postgres:// or postgresql://')
}
const urlDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''))
if (!urlDatabase || urlDatabase.includes('/') || urlDatabase !== expectedDatabase) {
  throw new Error(
    `MIGRATION_DATABASE_URL names ${urlDatabase || '(none)'}, expected ${expectedDatabase}`,
  )
}

process.stdin.setEncoding('utf8')
let input = ''
for await (const chunk of process.stdin) input += chunk
const passwordValue = input.endsWith('\r\n')
  ? input.slice(0, -2)
  : input.endsWith('\n')
    ? input.slice(0, -1)
    : input
const password = normalizeAdminPassword(passwordValue, true)
const pepper = parseAdminAuthPepper(process.env.ADMIN_AUTH_PEPPER)
const salt = randomBytes(ADMIN_PASSWORD_SALT_BYTES)
const passwordHash = await deriveAdminPasswordHash(
  password,
  salt,
  pepper,
  ADMIN_PASSWORD_ITERATIONS,
)

const sql = postgres(connectionString, {
  max: 1,
  fetch_types: false,
  connect_timeout: 5,
  idle_timeout: 5,
  max_lifetime: 30,
  connection: {
    application_name: 'cs2cup-admin-credential',
    statement_timeout: 15_000,
    lock_timeout: 5_000,
  },
})

try {
  const databaseRows = await sql`
    select pg_catalog.current_database() as database
  `
  if (databaseRows[0]?.database !== expectedDatabase) {
    throw new Error(
      `Connected to ${databaseRows[0]?.database ?? '(unknown)'}, expected ${expectedDatabase}`,
    )
  }

  const migrationRows = await sql`
    select
      to_regprocedure(
        'app_private.set_local_admin_credential(text,text,integer,bytea,bytea,uuid)'
      ) is not null
      and exists (
        select 1
        from public.schema_migration
        where phase = 'expand'
          and filename = '022_local_admin_authentication.sql'
      ) as ready
  `
  if (migrationRows[0]?.ready !== true) {
    throw new Error('Migration 022 is not applied to the target database')
  }

  const rows = await sql`
    select app_private.set_local_admin_credential(
      ${username}::text,
      ${ADMIN_PASSWORD_ALGORITHM}::text,
      ${ADMIN_PASSWORD_ITERATIONS}::integer,
      pg_catalog.decode(${bytesToHex(salt)}, 'hex'),
      pg_catalog.decode(${bytesToHex(passwordHash)}, 'hex'),
      ${crypto.randomUUID()}::uuid
    ) as result
  `
  const result = rows[0]?.result
  if (
    result?.ok !== true ||
    typeof result.principalId !== 'string' ||
    typeof result.credentialCreated !== 'boolean' ||
    typeof result.principalCreated !== 'boolean'
  ) {
    throw new Error('Credential provisioning returned an invalid response')
  }

  console.log(
    `${result.credentialCreated ? 'provisioned' : 'rotated'} administrator credential ` +
    `for ${username} in ${expectedDatabase}; all previous sessions are revoked`,
  )
} finally {
  await sql.end({ timeout: 5 })
}
