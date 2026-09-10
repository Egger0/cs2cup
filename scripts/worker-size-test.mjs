import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { promisify } from 'node:util'

const LIMIT_KIB = 65536
const MAX_UPLOAD_KIB = LIMIT_KIB
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
const match = output.match(/Total Upload:\s*([\d.]+)\s*KiB/i)

if (!match) {
  process.stderr.write(output)
  throw new Error('Wrangler did not report an upload size')
}

const uploadKiB = Number(match[1])
if (!Number.isFinite(uploadKiB)) throw new Error('Wrangler reported an invalid upload size')

const share = ((uploadKiB / LIMIT_KIB) * 100).toFixed(1)
console.log(
  `Worker upload: ${uploadKiB.toFixed(2)} KiB / ${MAX_UPLOAD_KIB} KiB budget (${share}% of the ${LIMIT_KIB} KiB platform limit)`,
)
if (uploadKiB > MAX_UPLOAD_KIB) {
  throw new Error(
    `Worker exceeds the project budget by ${(uploadKiB - MAX_UPLOAD_KIB).toFixed(2)} KiB`,
  )
}
