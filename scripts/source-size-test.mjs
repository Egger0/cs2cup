import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const MAX_LINES = 300
const extensions = new Set(['.cjs', '.css', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const execFileAsync = promisify(execFile)

async function sourceFiles() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  )
  return stdout
    .split('\0')
    .filter(file => file && extensions.has(extname(file)))
    .sort()
}

function sourceLines(source) {
  return source.split('\n').filter(line => line.trim()).length
}

const files = await sourceFiles()
const oversized = []
let checked = 0
for (const file of files) {
  const source = await readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (source === null) continue
  checked += 1
  const lines = sourceLines(source)
  if (lines > MAX_LINES) oversized.push({ file, lines })
}

if (oversized.length) {
  for (const entry of oversized) console.error(`${entry.file}: ${entry.lines} lines`)
  throw new Error(`Source files must stay within ${MAX_LINES} non-empty lines`)
}

console.log(`${checked} source files stay within ${MAX_LINES} non-empty lines`)
