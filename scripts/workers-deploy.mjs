import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const commitPattern = /^[0-9a-f]{40}$/

function abort(message) {
  console.error(message)
  process.exit(1)
}

if (process.env.CI !== 'true' || process.env.WORKERS_CI !== '1') {
  abort('Remote deployment is restricted to Cloudflare Workers Builds.')
}
if (!commitPattern.test(process.env.WORKERS_CI_COMMIT_SHA ?? '')) {
  abort('Cloudflare Workers Builds commit provenance is missing.')
}
if (!existsSync(new URL('../.open-next/worker.js', import.meta.url))) {
  abort('The Cloudflare Worker must be built before deployment.')
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const branch = process.env.WORKERS_CI_BRANCH
if (!branch) abort('Cloudflare Workers Builds branch provenance is missing.')
if (branch !== 'main') {
  run('opennextjs-cloudflare', ['upload'])
  process.exit(0)
}

run('wrangler', ['d1', 'migrations', 'apply', 'CS2CUP_DB', '--remote'])
run('opennextjs-cloudflare', ['deploy'])
