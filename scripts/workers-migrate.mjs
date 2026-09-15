import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const environment = process.env
const productionDeploy =
  environment.CI === 'true' &&
  environment.WORKERS_CI === '1' &&
  environment.WORKERS_CI_BRANCH === 'main' &&
  environment.WRANGLER_COMMAND === 'deploy'

if (!productionDeploy) {
  console.log('Skipping remote D1 migrations outside a Workers Builds production deploy.')
  process.exit(0)
}

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const result = spawnSync(
  process.execPath,
  [wrangler, 'd1', 'migrations', 'apply', 'CS2CUP_DB', '--remote'],
  { stdio: 'inherit' },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
