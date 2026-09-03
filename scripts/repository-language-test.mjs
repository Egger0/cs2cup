import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'

const HAN = /\p{Script=Han}/u
const localizedDocuments = new Set(['docs/identity-product-language.zh-CN.md'])
const documentExtensions = new Set(['.md', '.json', '.jsonc', '.yaml', '.yml'])
const sourceExtensions = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.scss',
  '.ts',
  '.tsx',
])
const textFiles = new Set(['.editorconfig', '.env.example', '.gitattributes', '.gitignore'])
const run = promisify(execFile)

function commentHasHan(source, extension) {
  if (extension === '.css' || extension === '.scss') {
    return [...source.matchAll(/\/\*[\s\S]*?\*\//g)].some(match => HAN.test(match[0]))
  }

  const language = extension === '.tsx' || extension === '.jsx' ? ts.LanguageVariant.JSX : undefined
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, language, source)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      HAN.test(scanner.getTokenText())
    ) {
      return true
    }
  }
  return false
}

const violations = []
const { stdout } = await run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
for (const path of stdout.split('\0').filter(Boolean)) {
  const file = path
  if (HAN.test(path)) violations.push(`${path}: file name`)

  const extension = extname(file)
  const fullText = documentExtensions.has(extension) || textFiles.has(path)
  if (!fullText && !sourceExtensions.has(extension)) continue

  const source = await readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (source === null) continue
  if (
    fullText ? !localizedDocuments.has(path) && HAN.test(source) : commentHasHan(source, extension)
  ) {
    violations.push(`${path}: repository text`)
  }
}

if (violations.length) {
  for (const violation of violations) console.error(violation)
  throw new Error('Repository documentation, configuration, and comments must use English')
}

console.log('Repository documentation, configuration, and comments use English')
