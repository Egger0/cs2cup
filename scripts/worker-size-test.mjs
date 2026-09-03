import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

const MAX_GZIP_KIB = 2900
const run = promisify(execFile)
const wrangler = 'node_modules/wrangler/bin/wrangler.js'

await access('.open-next/worker.js').catch(() => {
  throw new Error('Cloudflare output is missing; run npm run cf:build first')
})

const { stdout, stderr } = await run(
  process.execPath,
  [wrangler, 'versions', 'upload', '--dry-run'],
  {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  },
)
const output = `${stdout}\n${stderr}`
const match = output.match(/gzip:\s*([\d.]+)\s*KiB/i)

if (!match) {
  process.stderr.write(output)
  throw new Error('Wrangler did not report a gzip bundle size')
}

const gzipKiB = Number(match[1])
if (!Number.isFinite(gzipKiB)) throw new Error('Wrangler reported an invalid gzip bundle size')

console.log(`Worker gzip size: ${gzipKiB.toFixed(2)} KiB / ${MAX_GZIP_KIB} KiB budget`)
if (gzipKiB > MAX_GZIP_KIB) {
  throw new Error(`Worker exceeds the project budget by ${(gzipKiB - MAX_GZIP_KIB).toFixed(2)} KiB`)
}
