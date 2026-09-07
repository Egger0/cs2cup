import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'

const run = promisify(execFile)
const scriptKinds = new Map([
  ['.ts', ts.ScriptKind.TS],
  ['.mts', ts.ScriptKind.TS],
  ['.cts', ts.ScriptKind.TS],
  ['.tsx', ts.ScriptKind.TSX],
  ['.jsx', ts.ScriptKind.TSX],
  ['.js', ts.ScriptKind.JS],
  ['.mjs', ts.ScriptKind.JS],
  ['.cjs', ts.ScriptKind.JS],
])
const lineCommentExtensions = new Set(['.sql'])
const blockCommentExtensions = new Set(['.css', '.scss'])

function scriptComments(source, kind) {
  const sourceFile = ts.createSourceFile('source', source, ts.ScriptTarget.Latest, true, kind)
  const positions = new Map()
  const collect = node => {
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []) {
      positions.set(range.pos, range.end)
    }
    for (const range of ts.getTrailingCommentRanges(source, node.getEnd()) ?? []) {
      positions.set(range.pos, range.end)
    }
    if (ts.isJsxExpression(node) && !node.expression) {
      positions.set(node.getStart(), node.getEnd())
    }
    node.forEachChild(collect)
  }
  collect(sourceFile)
  return [...positions.entries()]
}

const violations = []
const { stdout } = await run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
for (const path of stdout.split('\0').filter(Boolean)) {
  const extension = extname(path)
  const kind = scriptKinds.get(extension)
  if (!kind && !lineCommentExtensions.has(extension) && !blockCommentExtensions.has(extension)) {
    continue
  }

  const source = await readFile(path, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (source === null) continue

  const found = []
  if (kind) {
    for (const [pos] of scriptComments(source, kind)) found.push(pos)
  } else if (blockCommentExtensions.has(extension)) {
    for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) found.push(match.index)
  } else {
    for (const match of source.matchAll(/^[^\n']*?--/gm)) found.push(match.index)
  }

  for (const position of found) {
    violations.push(`${path}:${source.slice(0, position).split('\n').length}`)
  }
}

if (violations.length) {
  console.error(`Source files must carry no comments:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Repository source files carry no comments')
