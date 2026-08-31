import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const MAX_LINES = 300
const roots = ['app', 'components']

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return cssFiles(path)
      return entry.isFile() && entry.name.endsWith('.css') ? [path] : []
    }),
  )
  return nested.flat()
}

function sourceLines(source) {
  let inComment = false
  let count = 0

  for (const rawLine of source.split('\n')) {
    let line = rawLine.trim()
    if (!line) continue
    if (inComment) {
      const end = line.indexOf('*/')
      if (end < 0) continue
      inComment = false
      line = line.slice(end + 2).trim()
    }
    while (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2)
      if (end < 0) {
        inComment = true
        line = ''
        break
      }
      line = line.slice(end + 2).trim()
    }
    if (line) count += 1
  }

  return count
}

const files = (await Promise.all(roots.map(cssFiles))).flat()
const oversized = []
for (const file of files) {
  const lines = sourceLines(await readFile(file, 'utf8'))
  if (lines > MAX_LINES) oversized.push({ file: relative(process.cwd(), file), lines })
}

if (oversized.length) {
  for (const entry of oversized) console.error(`${entry.file}: ${entry.lines} lines`)
  throw new Error(`CSS modules must stay within ${MAX_LINES} source lines`)
}

console.log(`${files.length} CSS files stay within ${MAX_LINES} source lines`)
