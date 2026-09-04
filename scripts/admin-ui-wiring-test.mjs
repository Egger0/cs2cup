import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

const nav = await read('app/admin/(console)/AdminNav.tsx')
const numberedPages = [
  ['03', 'app/admin/(console)/tournaments/page.tsx'],
  ['03.A', 'app/admin/(console)/tournaments/[id]/page.tsx'],
  ['03.B', 'app/admin/(console)/tournaments/[id]/staff/page.tsx'],
  ['04', 'app/admin/(console)/games/page.tsx'],
  ['05', 'app/admin/(console)/posts/page.tsx'],
  ['06', 'app/admin/(console)/photos/page.tsx'],
  ['07', 'app/admin/(console)/members/page.tsx'],
  ['08', 'app/admin/(console)/guestbook/page.tsx'],
  ['09', 'app/admin/(console)/settings/page.tsx'],
]

for (const [index, path] of numberedPages) {
  const page = await read(path)
  assert.match(page, new RegExp(`index=["']${index.replace('.', '\\.')}["']`), `${path} index`)
}
for (const [index, route] of [
  ['01', '/admin'],
  ['02', '/admin/identity'],
  ['03', '/admin/tournaments'],
  ['04', '/admin/games'],
  ['05', '/admin/posts'],
  ['06', '/admin/photos'],
  ['07', '/admin/members'],
  ['08', '/admin/guestbook'],
  ['09', '/admin/settings'],
]) {
  assert.match(nav, new RegExp(`index: ["']${index}["'][\\s\\S]{0,80}?href: ["']${route}["']`))
}
assert.match(await read('app/admin/(console)/identity/page.tsx'), /CONTROL \/ 02/)

const desk = await read('app/admin/(operations)/tournaments/[id]/check-in/CheckInDesk.tsx')
const deskStyles = await read(
  'app/admin/(operations)/tournaments/[id]/check-in/CheckInDesk.module.css',
)
assert.match(desk, /AUTO_REFRESH_MS = 15_000/)
assert.match(desk, /window\.setInterval\(refreshVisibleDesk, AUTO_REFRESH_MS\)/)
assert.match(desk, /writeInFlight\.current/)
assert.match(desk, /refreshInFlight\.current/)
assert.match(desk, /'刷新名单'/)
assert.doesNotMatch(desk, /--team-index/)
assert.doesNotMatch(deskStyles, /var\(--team-index\)/)

for (const path of [
  'app/admin/(console)/games/GameEditor.tsx',
  'app/admin/(console)/posts/PostEditor.tsx',
  'app/admin/(console)/members/MemberEditor.tsx',
  'app/admin/(console)/guestbook/GuestbookRow.tsx',
]) {
  const source = await read(path)
  assert.match(source, /catch \{/)
  assert.match(source, /role=["']alert["']/)
}
assert.match(await read('app/admin/(console)/AdminSignOut.tsx'), /退出失败，请重试/)

const identityStyles = await read('app/admin/(console)/identity/identity.module.css')
const identityOperations = await read('app/admin/(console)/identity/operations.module.css')
const auditLog = await read('app/admin/(console)/identity/AuditLog.tsx')
assert.match(identityStyles, /\.card h2[\s\S]+?overflow-wrap: anywhere/)
assert.match(
  identityStyles,
  /@media \(max-width: 820px\)[\s\S]+?\.card > header[\s\S]+?flex-direction: column/,
)
assert.match(identityOperations, /\.auditReason[\s\S]+?grid-column: 2 \/ -1/)
assert.match(auditLog, /className=\{styles\.auditReason\}/)

console.log('admin UI wiring tests passed')
