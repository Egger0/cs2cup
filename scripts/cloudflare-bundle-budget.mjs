import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const FREE_LIMIT_KIB = 3 * 1024
const REQUIRED_HEADROOM_KIB = 256
const MAX_GZIP_KIB = FREE_LIMIT_KIB - REQUIRED_HEADROOM_KIB
const outputDirectory = await mkdtemp(join(tmpdir(), 'cs2cup-worker-budget-'))

try {
  const wrangler = join(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  const result = spawnSync(
    process.execPath,
    [wrangler, 'deploy', '--dry-run', '--outdir', outputDirectory],
    { encoding: 'utf8', env: process.env },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  process.stdout.write(output)

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Wrangler dry-run failed with exit code ${result.status ?? 'unknown'}`)
  }

  const match = output.match(/gzip:\s*([\d.]+)\s*KiB/)
  if (!match) throw new Error('Wrangler did not report a compressed Worker size')

  const gzipKiB = Number(match[1])
  if (!Number.isFinite(gzipKiB) || gzipKiB > MAX_GZIP_KIB) {
    throw new Error(
      `Compressed Worker is ${gzipKiB.toFixed(2)} KiB; `
      + `budget is ${MAX_GZIP_KIB} KiB (${REQUIRED_HEADROOM_KIB} KiB below Free limit)`,
    )
  }

  console.log(
    `Cloudflare bundle budget passed: ${gzipKiB.toFixed(2)} KiB `
    + `<= ${MAX_GZIP_KIB} KiB`,
  )
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}
