import assert from 'node:assert/strict'

import { parsePasswordPepperSet } from '../lib/identity/internal/password-config.ts'

const first = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
const second = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI'
const peppers = parsePasswordPepperSet(JSON.stringify({ 4: first, 5: second }), '5')
assert.equal(peppers.active.version, 5)
assert.equal(peppers.active.key.byteLength, 32)
assert.deepEqual([...peppers.byVersion.keys()], [4, 5])

for (const [raw, active] of [
  [undefined, '1'],
  ['{}', '1'],
  [JSON.stringify({ 0: first }), '0'],
  [JSON.stringify({ 1: 'not-base64url' }), '1'],
  [JSON.stringify({ 1: first }), '2'],
]) {
  assert.throws(() => parsePasswordPepperSet(raw, active), /pepper/i)
}

console.log('identity password pepper configuration passed')
