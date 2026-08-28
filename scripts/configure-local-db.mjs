import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const database = process.env.MIGRATION_DB_NAME ?? 'cs2cup'
if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('MIGRATION_DB_NAME must contain only letters, digits and underscores')
}

const sql = `
alter role anon_authenticator login password 'local-anon-only';
alter role admin_authenticator login password 'local-admin-only';
`
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
    '-q',
    '-f',
    '-',
  ],
  { cwd: ROOT, encoding: 'utf8', input: sql },
)

if (result.status !== 0) {
  process.stderr.write(result.stdout)
  process.stderr.write(result.stderr)
  throw new Error(`Local database configuration failed with exit code ${result.status}`)
}

console.log(`configured local PostgREST authenticators for ${database}`)
