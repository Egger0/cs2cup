import { readdir, readFile, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(ROOT, 'wrangler.local.jsonc')
const ENV_PATH = join(ROOT, 'wrangler.local.env')
const MIGRATIONS_PATH = join(ROOT, 'cloudflare', 'd1')
const SEED_PATH = join(ROOT, 'cloudflare', 'fixtures', 'local-seed.sql')
const STATE_ROOT = join(ROOT, '.local', 'cloudflare')
const PERSIST_PATH = join(STATE_ROOT, 'v3')
const COMMANDS = new Set(['migrate', 'seed', 'reset'])
const FIXTURE_VARIANT_WIDTHS = [480, 960]
const CREDENTIAL_VARIABLES = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_EMAIL',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
]

function assertStatePath() {
  const child = relative(ROOT, STATE_ROOT)
  if (child !== join('.local', 'cloudflare') || isAbsolute(child) || child.startsWith(`..${sep}`)) {
    throw new Error('Refusing to modify an unexpected local state path')
  }
}

async function migrationFiles() {
  return (await readdir(MIGRATIONS_PATH))
    .filter(name => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name))
    .sort()
}

function statements(db, splitSqlQuery, sql) {
  return splitSqlQuery(sql)
    .filter(part => part.trim())
    .map(part => db.prepare(part))
}

async function migrate(db, splitSqlQuery) {
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run()
  const applied = await db.prepare('SELECT name FROM d1_migrations').all()
  const names = new Set(applied.results.map(row => row.name))

  for (const name of await migrationFiles()) {
    if (names.has(name)) continue
    const sql = await readFile(join(MIGRATIONS_PATH, name), 'utf8')
    await db.batch([
      ...statements(db, splitSqlQuery, sql),
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name),
    ])
  }
}

async function seed(db, splitSqlQuery) {
  const sql = await readFile(SEED_PATH, 'utf8')
  await db.batch(statements(db, splitSqlQuery, sql))
}

async function seedMedia(bucket, db) {
  if (!bucket) throw new Error('The local R2 binding is missing')
  const sharp = (await import('sharp')).default
  const { results } = await db.prepare('SELECT storage_key, width, height FROM photo').all()

  for (const photo of results) {
    const widths = [photo.width, ...FIXTURE_VARIANT_WIDTHS]
    for (const width of widths) {
      const height = Math.max(1, Math.round((photo.height * width) / photo.width))
      const body = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 24, g: 26, b: 30 },
          noise: { type: 'gaussian', mean: 128, sigma: 42 },
        },
      })
        .webp({ quality: 82 })
        .toBuffer()
      const key =
        width === photo.width
          ? photo.storage_key
          : photo.storage_key.replace(/\.webp$/, `.${width}.webp`)
      await bucket.put(key, body, { httpMetadata: { contentType: 'image/webp' } })
    }
  }
}

const command = process.argv[2]
if (!COMMANDS.has(command) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/local-database.mjs <migrate|seed|reset>')
}

assertStatePath()
if (command === 'reset') await rm(STATE_ROOT, { recursive: true, force: true })

for (const name of CREDENTIAL_VARIABLES) delete process.env[name]
process.env.WRANGLER_SEND_METRICS = 'false'

const { getPlatformProxy, unstable_splitSqlQuery: splitSqlQuery } = await import('wrangler')
const proxy = await getPlatformProxy({
  configPath: CONFIG_PATH,
  envFiles: [ENV_PATH],
  persist: { path: PERSIST_PATH },
  remoteBindings: false,
})

try {
  const db = proxy.env.CS2CUP_DB
  if (!db) throw new Error('The local D1 binding is missing')
  await migrate(db, splitSqlQuery)
  if (command !== 'migrate') {
    await seed(db, splitSqlQuery)
    await seedMedia(proxy.env.CS2CUP_MEDIA, db)
  }
  console.log(`Local database ${command} completed`)
} finally {
  await proxy.dispose()
}
