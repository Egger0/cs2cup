import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BASE = 'http://localhost:3000'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

async function waitForWorker(worker) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Local Worker exited with ${worker.exitCode}`)
    let responding = false
    try {
      const response = await fetch(BASE, { redirect: 'manual' })
      responding = response.status > 0
    } catch {
      responding = false
    }
    if (responding) return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250))
  }
  throw new Error('Local Worker did not become ready within 30 seconds')
}

run(npm, ['run', 'cf:build:local'])
run(npm, ['run', 'db:local:reset'])
run(process.execPath, [
  '--conditions=react-server',
  '--experimental-strip-types',
  'scripts/identity-browser-fixture.mjs',
])

const worker = spawn(
  npx,
  [
    '--no-install',
    'wrangler',
    'dev',
    '--env-file',
    'wrangler.local.env',
    '--config',
    'wrangler.local.jsonc',
    '--config',
    'wrangler.browser-password-range.jsonc',
    '--ip',
    '127.0.0.1',
    '--port',
    '3000',
    '--persist-to',
    '.local/cloudflare',
    '--var',
    'IDENTITY_PASSWORD_SCREENING_LOCAL_SERVICE:browser-check',
  ],
  { cwd: ROOT, env: process.env, stdio: ['ignore', 'inherit', 'inherit'] },
)

try {
  await waitForWorker(worker)
  const environment = { E2E_BASE_URL: BASE }
  for (const script of [
    'scripts/a11y.mjs',
    'scripts/keyboard.mjs',
    'scripts/perf.mjs',
    'scripts/identity-signup-browser.mjs',
    'scripts/identity-migration-browser.mjs',
    'scripts/identity-browser.mjs',
  ]) {
    run(process.execPath, [script], environment)
  }
} finally {
  if (worker.exitCode === null) {
    worker.kill('SIGTERM')
    await Promise.race([
      once(worker, 'exit'),
      new Promise(resolveDelay => setTimeout(resolveDelay, 5_000)),
    ])
  }
}
