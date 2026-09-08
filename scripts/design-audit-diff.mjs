import { readdir, readFile } from 'node:fs/promises'

const VOLATILE = new Set(['account', 'account-security', 'admin-identity'])

const [baseline = 'output/design-audit-baseline', current = 'output/design-audit'] =
  process.argv.slice(2)

const shots = (await readdir(baseline)).filter(name => name.endsWith('.png')).sort()
if (!shots.length) throw new Error(`No baseline shots in ${baseline}`)

const differing = []
let compared = 0
let skipped = 0
for (const shot of shots) {
  if (VOLATILE.has(shot.replace(/-(desktop|mobile)\.png$/, ''))) {
    skipped += 1
    continue
  }
  const [before, after] = await Promise.all([
    readFile(`${baseline}/${shot}`),
    readFile(`${current}/${shot}`).catch(() => null),
  ])
  compared += 1
  if (!after) differing.push(`${shot}: missing`)
  else if (!before.equals(after))
    differing.push(`${shot}: ${before.length} vs ${after.length} bytes`)
}

if (differing.length) {
  console.error(`Design audit changed (${differing.length}):\n${differing.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`Design audit: ${compared} shots identical, ${skipped} volatile shots skipped`)
}
