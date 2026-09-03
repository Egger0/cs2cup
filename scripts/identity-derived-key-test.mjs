import assert from 'node:assert/strict'

import { deriveIdentitySubkey } from '../lib/identity/internal/derived-key.ts'

const master = 'this test master secret contains more than thirty-two bytes'
const password = await deriveIdentitySubkey(master, 'cs2cup/identity/password-pepper/v1')
const repeated = await deriveIdentitySubkey(master, 'cs2cup/identity/password-pepper/v1')
const fingerprint = await deriveIdentitySubkey(master, 'cs2cup/identity/auth-fingerprint/v1')
assert.equal(password.byteLength, 32)
assert.deepEqual(password, repeated)
assert.notDeepEqual(password, fingerprint)
await assert.rejects(
  deriveIdentitySubkey('short', 'cs2cup/identity/password-pepper/v1'),
  /master secret/,
)
await assert.rejects(deriveIdentitySubkey(master, '../invalid'), /master secret/)

console.log('identity derived subkeys passed')
