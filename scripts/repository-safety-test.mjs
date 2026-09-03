import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import ts from 'typescript'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const packageJson = JSON.parse(await read('package.json'))
const scripts = packageJson.scripts ?? {}
const migrationNames = await readdir(new URL('../cloudflare/d1/', import.meta.url))
const forbiddenScriptPatterns = [
  /\bnpx\b/i,
  /(^|\s)--remote(?:\s|$)/i,
  /\bwrangler\s+(?:delete|deploy|login|publish|secret|tail|whoami)\b/i,
  /\bopennextjs-cloudflare\s+(?:deploy|upload)\b/i,
  /\b(?:CLOUDFLARE|CF)_(?:ACCOUNT|API|EMAIL|TOKEN)[A-Z_]*\b/,
]

for (const [name, command] of Object.entries(scripts)) {
  for (const pattern of forbiddenScriptPatterns) {
    assert.doesNotMatch(command, pattern, `unsafe package script: ${name}`)
  }
}

assert.match(scripts.dev, /^npm run db:local:migrate && next dev$/)
assert.equal(scripts.deploy, 'node scripts/workers-deploy.mjs')
assert.equal(scripts['postcf:build'], undefined)
assert.doesNotMatch(scripts['cf:build'], /wrangler\.local\.jsonc/)
assert.match(scripts['cf:build:local'], /--config wrangler\.local\.jsonc/)
assert.equal(scripts['cf:preview'], undefined)
assert.ok(
  migrationNames.every(name => /^\d{4}_[a-z0-9_-]+\.sql$/.test(name)),
  'D1 migrations must only include numbered migration files',
)

const localConfigSource = await read('wrangler.local.jsonc')
const parsedLocalConfig = ts.parseConfigFileTextToJson('wrangler.local.jsonc', localConfigSource)
if (parsedLocalConfig.error) throw new Error('wrangler.local.jsonc is invalid')
const localConfig = parsedLocalConfig.config
assert.match(localConfig.name, /local-only/)
assert.equal(localConfig.send_metrics, false)

for (const binding of localConfig.d1_databases ?? []) {
  assert.match(binding.database_name, /local/)
  assert.equal(binding.remote, false)
  assert.equal('database_id' in binding, false)
  assert.equal('preview_database_id' in binding, false)
}
for (const binding of localConfig.r2_buckets ?? []) {
  assert.match(binding.bucket_name, /local/)
  assert.equal(binding.remote, false)
  assert.equal('preview_bucket_name' in binding, false)
}

const localDatabase = await read('scripts/local-database.mjs')
const workersDeploy = await read('scripts/workers-deploy.mjs')
const localEnvironment = await read('wrangler.local.env')
const developmentEnvironment = await read('.env.development')
assert.match(localDatabase, /configPath: CONFIG_PATH/)
assert.match(localDatabase, /remoteBindings: false/)
assert.match(localDatabase, /envFiles: \[ENV_PATH\]/)
assert.match(localDatabase, /PERSIST_PATH = join\(STATE_ROOT, 'v3'\)/)
assert.match(workersDeploy, /WORKERS_CI/)
assert.match(workersDeploy, /WORKERS_CI_BRANCH/)
assert.match(workersDeploy, /migrations.*apply.*CS2CUP_DB.*--remote/s)
assert.match(workersDeploy, /opennextjs-cloudflare.*deploy/s)
assert.match(workersDeploy, /opennextjs-cloudflare.*upload/s)

const nextConfig = await read('next.config.ts')
assert.match(nextConfig, /configPath: ['"]\.\/wrangler\.local\.jsonc['"]/)
assert.match(nextConfig, /envFiles: \[['"]wrangler\.local\.env['"]\]/)
assert.match(nextConfig, /remoteBindings: false/)
assert.match(nextConfig, /persist: \{ path: ['"]\.\/\.local\/cloudflare\/v3['"] \}/)
assert.doesNotMatch(localEnvironment, /^[A-Z_][A-Z0-9_]*=/m)
assert.equal(developmentEnvironment.trim(), 'NEXT_PUBLIC_SITE_URL=http://localhost:3000')

const qualityWorkflow = await read('.github/workflows/quality.yml')
assert.doesNotMatch(qualityWorkflow, /secrets\./)
assert.doesNotMatch(qualityWorkflow, /\bdeploy\b/i)

console.log('repository safety tests passed')
