import assert from 'node:assert/strict'

import { parseEnrollmentApplication } from '../lib/identity/internal/enrollment-policy.ts'

const form = new FormData()
form.set('displayName', '  明澈  ')
form.set('identityClaim', '  学号 20260001  ')
form.set('contact', '  contact@example.test  ')
form.set('reason', '  参加校内赛事\n并管理队伍  ')
assert.deepEqual(parseEnrollmentApplication(form), {
  ok: true,
  value: {
    displayName: '明澈',
    identityClaim: '学号 20260001',
    contact: 'contact@example.test',
    reason: '参加校内赛事\n并管理队伍',
  },
})

for (const [field, value, reason] of [
  ['displayName', '', 'required'],
  ['identityClaim', 'ab', 'required'],
  ['contact', 'a'.repeat(161), 'too_long'],
  ['displayName', 'safe\u202eevil', 'invalid_characters'],
  ['reason', `safe${String.fromCharCode(0)}unsafe`, 'invalid_characters'],
]) {
  const invalid = new FormData()
  for (const [name, entry] of form.entries()) invalid.set(name, entry)
  invalid.set(field, value)
  assert.deepEqual(parseEnrollmentApplication(invalid), { ok: false, field, reason })
}

console.log('identity moderated enrollment input policy passed')
