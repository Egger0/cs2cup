import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BASE = 'http://localhost:3000'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const options = new Set(process.argv.slice(2))
const smokeOnly = options.has('--smoke')
const skipBuild = options.has('--skip-build')
const only = process.argv
  .find(argument => argument.startsWith('--only='))
  ?.slice('--only='.length)
  .split(',')
  .map(name => `scripts/${name}.mjs`)

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`)
}

async function runConcurrently(scripts, extraEnv, limit) {
  const failures = []
  let next = 0
  const worker = async () => {
    while (next < scripts.length) {
      const script = scripts[next++]
      const child = spawn(process.execPath, [script], {
        cwd: ROOT,
        env: { ...process.env, ...extraEnv },
        stdio: 'inherit',
      })
      const [code] = await once(child, 'exit')
      if (code !== 0) failures.push(script)
    }
  }
  await Promise.all(Array.from({ length: limit }, worker))
  if (failures.length) throw new Error(`Browser checks failed: ${failures.join(', ')}`)
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

if (!skipBuild) run(npm, ['run', 'cf:build:local'])
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
  const readOnly = [
    'scripts/a11y.mjs',
    'scripts/share-browser.mjs',
    'scripts/keyboard.mjs',
    'scripts/layout-browser.mjs',
    'scripts/header-fallback-browser.mjs',
    'scripts/home-motion-browser.mjs',
  ]
  const writing = [
    'scripts/discovery-browser.mjs',
    'scripts/frontend-browser.mjs',
    'scripts/auth-feedback-browser.mjs',
    'scripts/identity-signup-browser.mjs',
    'scripts/admin-ui-browser.mjs',
  ]
  const full = smokeOnly
    ? []
    : [
        'scripts/identity-migration-browser.mjs',
        'scripts/identity-browser.mjs',
        'scripts/recruitment-lottery-browser.mjs',
      ]
  if (only) for (const script of only) run(process.execPath, [script], environment)
  else {
    await runConcurrently(readOnly, environment, 3)
    for (const script of [...writing, ...full]) run(process.execPath, [script], environment)
    run(process.execPath, ['scripts/perf.mjs'], environment)
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
