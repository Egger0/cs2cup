import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const seedDir = 'seeds'
const files = (await readdir(seedDir)).filter(file => file.endsWith('.sql')).sort()

if (files.length === 0) {
  throw new Error(`No SQL seed files found in ${seedDir}`)
}

for (const file of files) {
  const sql = await readFile(join(seedDir, file))
  const process = spawn(
    'docker',
    ['compose', 'exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'cs2cup', '-q', '-f', '-'],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )

  process.stdin.end(sql)

  const code = await new Promise((resolve, reject) => {
    process.once('error', reject)
    process.once('exit', resolve)
  })

  if (code !== 0) {
    throw new Error(`Failed to apply ${file}`)
  }
}
