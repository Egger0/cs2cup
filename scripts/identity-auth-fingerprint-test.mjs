import assert from 'node:assert/strict'

import { createAuthAttemptFingerprint } from '../lib/identity/internal/auth-fingerprint.ts'
import { parseAuthFingerprintKey } from '../lib/identity/internal/auth-fingerprint-config.ts'

const encodedKey = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
const key = parseAuthFingerprintKey(JSON.stringify({ 7: encodedKey }), '7')
const first = await createAuthAttemptFingerprint(key, 'sign_in', 'identity', 'player.one')
const repeated = await createAuthAttemptFingerprint(key, 'sign_in', 'identity', 'player.one')
const otherPurpose = await createAuthAttemptFingerprint(key, 'recovery', 'identity', 'player.one')
assert.equal(first.fingerprintKeyVersion, 7)
assert.match(first.fingerprintHash, /^[0-9a-f]{64}$/)
assert.deepEqual(first, repeated)
assert.notEqual(first.fingerprintHash, otherPurpose.fingerprintHash)
assert.throws(() => parseAuthFingerprintKey('{}', '7'), /fingerprint/i)

console.log('identity authentication attempt fingerprinting passed')
