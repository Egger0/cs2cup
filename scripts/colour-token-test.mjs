import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const THEMES = new Set([
  'app/globals.css',
  'app/layout-tokens.css',
  'app/site-theme.module.css',
  'app/not-found.module.css',
  'app/admin/(console)/shell.module.css',
  'app/admin/(operations)/tournaments/[id]/check-in/check-in.module.css',
  'app/admin/login/login.module.css',
])

const PALETTE = new Set([
  '--void',
  '--bg',
  '--bg-2',
  '--surface',
  '--surface-2',
  '--line',
  '--line-strong',
  '--ink',
  '--muted',
  '--muted-2',
  '--ct',
  '--ct-dim',
  '--t',
  '--t-dim',
  '--c4',
  '--honour',
  '--accent',
  '--accent-dim',
  '--accent-strong',
  '--button-ink',
  '--danger-dim',
  '--toast-ink',
])

const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:/i

const { stdout } = await run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
const files = stdout.split('\0').filter(file => file.endsWith('.css'))

const violations = []
for (const file of files) {
  if (THEMES.has(file)) continue
  const source = await readFile(file, 'utf8')
  source.split('\n').forEach((line, index) => {
    const name = DECLARATION.exec(line)?.[1]
    if (name && PALETTE.has(name)) {
      violations.push(`${file}:${index + 1}  ${name} is a palette token; use the theme's value`)
    }
  })
}

if (violations.length) {
  console.error(`Local palettes shadowing theme tokens (${violations.length}):`)
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Colour tokens: ${files.length} stylesheets checked, no local palettes`)
}
