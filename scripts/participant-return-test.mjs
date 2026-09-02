import assert from 'node:assert/strict'

import {
  DEFAULT_PARTICIPANT_RETURN_PATH,
  isParticipantReturnPath,
  participantEntryAddedId,
  participantEntryAddedPath,
  participantRegistrationReturnPath,
  safeParticipantReturnPath,
} from '../lib/participant-return.ts'

const token = 'A_-a09'.repeat(7) + 'A'
const longestSlug = `a${'-a'.repeat(49)}-`
const registrationPath = `/tournaments/autumn-cup-2026/registration/${token}`

assert.equal(token.length, 43)
assert.equal(longestSlug.length, 100)

for (const path of [
  '/me',
  registrationPath,
  `/tournaments/a/registration/${token}`,
  `/tournaments/${longestSlug}/registration/${token}`,
]) {
  assert.equal(isParticipantReturnPath(path), true, `expected allowed path: ${path}`)
  assert.equal(safeParticipantReturnPath(path), path)
}

assert.equal(participantRegistrationReturnPath('autumn-cup-2026', token), registrationPath)
assert.equal(participantRegistrationReturnPath('Autumn-cup', token), null)
assert.equal(participantRegistrationReturnPath('autumn-cup', `${token}?next=/me`), null)
const entryAddedPath = participantEntryAddedPath(37)
assert.equal(entryAddedPath, '/me?joined=37')
assert.equal(participantEntryAddedId('37'), 37)
assert.equal(participantEntryAddedId(['37']), null)
assert.equal(participantEntryAddedId('037'), null)
assert.equal(participantEntryAddedId('9007199254740992'), null)
assert.equal(participantEntryAddedPath(0), null)
assert.equal(participantEntryAddedPath(Number.MAX_SAFE_INTEGER + 1), null)
assert.equal(isParticipantReturnPath(entryAddedPath), false)
assert.equal(safeParticipantReturnPath(entryAddedPath), DEFAULT_PARTICIPANT_RETURN_PATH)

for (const value of [
  undefined,
  null,
  7,
  ['/me'],
  [],
  '',
  '/',
  '/me/',
  '/me?continue=1',
  '/me#entry',
  '//example.com/me',
  'https://example.com/me',
  'javascript:alert(1)',
  '%2Fme',
  '/%6de',
  `/tournaments/autumn-cup-2026/registration/${token}?next=/me`,
  `/tournaments/autumn-cup-2026/registration/${token}#entry`,
  `/tournaments/Autumn-cup/registration/${token}`,
  `/tournaments/autumn_cup/registration/${token}`,
  `/tournaments/-autumn-cup/registration/${token}`,
  `/tournaments/${`a${'-a'.repeat(50)}`}/registration/${token}`,
  `/tournaments/autumn-cup/registration/${token.slice(1)}`,
  `/tournaments/autumn-cup/registration/${token}!`,
  `/tournaments/autumn-cup/registration/${token}\n`,
  `/tournaments/autumn-cup/registration/${token}\r`,
  `/tournaments/autumn-cup/registration/${token}\u2028`,
  `/tournaments/autumn-cup%2Fregistration%2F${token}`,
]) {
  assert.equal(isParticipantReturnPath(value), false, `expected rejected value: ${String(value)}`)
  assert.equal(safeParticipantReturnPath(value), DEFAULT_PARTICIPANT_RETURN_PATH)
}

console.log('participant return path tests passed')
