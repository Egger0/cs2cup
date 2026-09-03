import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const commitPattern = /^[0-9a-f]{40}$/

function abort(message) {
  console.error(message)
  process.exit(1)
}

if (process.env.WORKERS_CI !== '1') {
  console.log('Skipping remote migrations outside Cloudflare Workers Builds.')
  process.exit(0)
}
if (process.env.CI !== 'true') abort('Cloudflare Workers Builds CI provenance is missing.')
if (process.env.WORKERS_CI_BRANCH !== 'main') {
  console.log('Skipping remote migrations for a non-production branch.')
  process.exit(0)
}
if (!commitPattern.test(process.env.WORKERS_CI_COMMIT_SHA ?? '')) {
  abort('Cloudflare Workers Builds commit provenance is missing.')
}
if (!existsSync(new URL('../.open-next/worker.js', import.meta.url))) {
  abort('The Cloudflare Worker must be built before migration.')
}

const result = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'CS2CUP_DB', '--remote'], {
  stdio: 'inherit',
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
