import assert from 'node:assert/strict'

import { evaluateSelfRegistration } from '../lib/identity/internal/self-registration-policy.ts'

const valid = {
  username: 'player.one',
  displayName: '参赛者一号',
  password: '一段只在这里使用的足够长密码短语 2048',
  passwordConfirmation: '一段只在这里使用的足够长密码短语 2048',
}

assert.deepEqual(evaluateSelfRegistration(valid), {
  ok: true,
  value: {
    username: 'player.one',
    displayName: '参赛者一号',
    normalizedPassword: valid.password,
  },
})
assert.deepEqual(evaluateSelfRegistration({ ...valid, username: ' admin ' }), {
  ok: false,
  issue: { field: 'username', reason: 'reserved' },
})
assert.deepEqual(evaluateSelfRegistration({ ...valid, displayName: '\u202ehidden' }), {
  ok: false,
  issue: { field: 'displayName', reason: 'invalid_characters' },
})
assert.deepEqual(
  evaluateSelfRegistration({ ...valid, password: 'short', passwordConfirmation: 'short' }),
  {
    ok: false,
    issue: { field: 'password', reason: 'too_short' },
  },
)
assert.deepEqual(
  evaluateSelfRegistration({ ...valid, passwordConfirmation: `${valid.password}!` }),
  {
    ok: false,
    issue: { field: 'passwordConfirmation', reason: 'mismatch' },
  },
)
assert.deepEqual(
  evaluateSelfRegistration({
    ...valid,
    username: 'my-player-account',
    password: 'my-player-account has lots of characters',
    passwordConfirmation: 'my-player-account has lots of characters',
  }),
  { ok: false, issue: { field: 'password', reason: 'contains_account_context' } },
)

console.log('identity self-registration policy tests passed')
