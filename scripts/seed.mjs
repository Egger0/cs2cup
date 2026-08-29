import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const database = process.env.SEED_DB_NAME ?? 'cs2cup'
if (!/^[a-zA-Z0-9_]+$/.test(database)) {
  throw new Error('SEED_DB_NAME must contain only letters, digits and underscores')
}

const seedDir = join(ROOT, 'seeds')
const files = (await readdir(seedDir)).filter(file => file.endsWith('.sql')).sort()

if (files.length === 0) {
  throw new Error(`No SQL seed files found in ${seedDir}`)
}

for (const file of files) {
  const sql = await readFile(join(seedDir, file))
  const process = spawn(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-f',
      '-',
    ],
    { cwd: ROOT, stdio: ['pipe', 'inherit', 'inherit'] },
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
