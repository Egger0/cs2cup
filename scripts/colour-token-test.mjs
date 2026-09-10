import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

const DECLARING = new Set([
  'app/layout-tokens.css',
  'app/(public)/public-theme.module.css',
  'app/admin/(console)/shell.module.css',
  'app/me/me.module.css',
  'app/account/account.module.css',
  'app/account/membership.module.css',
])

const TOKENISED = new Map([
  ['#111210', '--void'],
  ['#f1efe8', '--bg / --ink / --button-ink'],
  ['#e9e6dc', '--bg-2'],
  ['#f7f5ee', '--surface'],
  ['#dfdcd2', '--surface-2'],
  ['rgba(23,24,23,0.15)', '--line'],
  ['#aaa69b', '--line-strong'],
  ['#171817', '--ink'],
  ['#5f605a', '--muted'],
  ['#62645d', '--muted-2'],
  ['#0b4d87', '--ct / --t / --accent'],
  ['rgba(11,77,135,0.1)', '--ct-dim / --t-dim'],
  ['#b52b3b', '--c4'],
  ['#8d661f', '--honour'],
  ['rgba(240,68,82,0.12)', '--danger-dim'],
  ['#6da5d3', '--accent'],
  ['#a9c9e2', '--accent-strong'],
  ['#1d1f1e', '--bg'],
  ['#141514', '--bg-2'],
  ['rgba(109,165,211,0.17)', '--line'],
  ['rgba(109,165,211,0.34)', '--line-strong'],
  ['rgba(109,165,211,0.12)', '--ct-dim / --t-dim'],
  ['#949792', '--muted'],
  ['#0d1215', '--bg'],
  ['#080b0d', '--bg-2'],
  ['rgba(132,167,185,0.1)', '--line'],
  ['#eeeadd', '--surface'],
  ['#e2dccd', '--surface-2'],
  ['#172026', '--surface-ink'],
  ['#626a6d', '--surface-muted'],
  ['#176b9a', '--accent-strong'],
  ['#79b9d8', '--accent'],
  ['#e9ece8', '--ink'],
  ['#0b5d94', '--accent'],
])

const PENDING = new Set([
  'app/(public)/about/page.module.css',
  'app/(public)/search/search.module.css',
  'app/(public)/tournaments/[slug]/register/register.module.css',
  'app/account/security/security.module.css',
  'app/admin/(console)/tournaments/[id]/staff/staff.module.css',
  'app/admin/login/login.module.css',
  'app/globals.css',
  'app/login/login.module.css',
  'app/me/access-receipt.module.css',
  'app/me/pass-reference.module.css',
  'app/me/registration-invitations.module.css',
  'app/me/registrations/[teamId]/registration.module.css',
  'app/me/registrations/registration-access.module.css',
  'app/noscript.module.css',
  'app/not-found.module.css',
  'components/admin/AdminPageHeader.module.css',
  'components/domain/PosterWall.module.css',
  'components/domain/RegistrationJourney.module.css',
  'components/home/HomeEvidence.module.css',
  'components/home/HomeHero.module.css',
  'components/home/HomeIndex.module.css',
  'components/home/HomeRoles.module.css',
  'components/layout/SiteFooter.module.css',
  'components/layout/SiteHeader.module.css',
  'components/layout/SiteHeaderFallback.module.css',
  'components/layout/SiteMenu.module.css',
  'components/layout/TournamentHeader.module.css',
  'components/share/Share.module.css',
  'components/ui/PasswordInput.module.css',
])

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g

function normalise(value) {
  const lower = value.toLowerCase().replace(/\s+/g, '')
  if (!lower.startsWith('#') || lower.length !== 4) return lower
  return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
}

const { stdout } = await run(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
const files = stdout.split('\0').filter(file => file.endsWith('.css'))

const violations = []
for (const file of files) {
  if (DECLARING.has(file) || PENDING.has(file)) continue
  const source = await readFile(file, 'utf8')
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(COLOUR)) {
      const token = TOKENISED.get(normalise(match[0]))
      if (token) violations.push(`${file}:${index + 1}  ${match[0]}  ->  ${token}`)
    }
  })
}

if (violations.length) {
  console.error(
    `Tokenised colours written as literals (${violations.length}):\n${violations.join('\n')}`,
  )
  process.exitCode = 1
} else {
  console.log(`Colour tokens: ${files.length} stylesheets checked, no tokenised literals`)
}
