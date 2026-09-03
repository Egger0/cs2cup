import assert from 'node:assert/strict'

import {
  evaluateUsernamePolicy,
  isCanonicalStoredUsername,
} from '../lib/identity/internal/username-policy.ts'

assert.deepEqual(evaluateUsernamePolicy('  Player.One  '), {
  ok: true,
  username: 'player.one',
})
for (const username of ['ab', '-player', 'player-', '玩家', 'player name', 'a'.repeat(33)]) {
  assert.equal(evaluateUsernamePolicy(username).ok, false)
}
for (const username of ['admin', 'ROOT', ' system ']) {
  assert.deepEqual(evaluateUsernamePolicy(username), { ok: false, reason: 'reserved' })
}
assert.equal(isCanonicalStoredUsername('player_2026'), true)
assert.equal(isCanonicalStoredUsername('Player_2026'), false)

console.log('identity username policy passed')
