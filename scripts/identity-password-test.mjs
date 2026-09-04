import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import {
  PASSWORD_KDF_ALGORITHM,
  PASSWORD_KDF_ITERATIONS,
  createPasswordVerifier,
  passwordVerifierNeedsUpgrade,
  passwordVerifierForStorage,
  passwordVerifierFromStorage,
  verifyPassword,
} from '../lib/identity/internal/password-kdf.ts'
import {
  PASSWORD_POLICY,
  evaluatePasswordPolicy,
} from '../lib/identity/internal/password-policy.ts'

const pepper = { version: 3, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const previousPepper = {
  version: 2,
  key: Uint8Array.from({ length: 32 }, (_, index) => 32 - index),
}

assert.equal(PASSWORD_POLICY.minCodePoints, 6)
assert.deepEqual(evaluatePasswordPolicy('short'), { ok: false, reason: 'too_short' })
assert.deepEqual(evaluatePasswordPolicy('a'.repeat(129)), { ok: false, reason: 'too_long' })
assert.deepEqual(evaluatePasswordPolicy(`valid-password-${String.fromCharCode(0xd800)}`), {
  ok: false,
  reason: 'invalid_unicode',
})
const decomposed = 'correct horse cafe\u0301 2026'
const policy = evaluatePasswordPolicy(decomposed)
assert.equal(policy.ok, true)
assert.equal(policy.ok && policy.normalizedPassword, decomposed.normalize('NFC'))

const startedAt = performance.now()
const record = await createPasswordVerifier(policy.ok ? policy.normalizedPassword : '', pepper)
assert.equal(record.algorithm, PASSWORD_KDF_ALGORITHM)
assert.equal(record.iterations, PASSWORD_KDF_ITERATIONS)
assert.equal(record.pepperVersion, pepper.version)
assert.match(record.salt, /^[A-Za-z0-9_-]{22}$/)
assert.match(record.verifier, /^[A-Za-z0-9_-]{43}$/)
assert.equal(await verifyPassword(decomposed.normalize('NFC'), record, pepper), true)
assert.equal(await verifyPassword('wrong password that is long enough', record, pepper), false)
assert.equal(await verifyPassword(decomposed.normalize('NFC'), record, previousPepper), false)
assert.equal(passwordVerifierNeedsUpgrade(record, pepper.version), false)
assert.equal(passwordVerifierNeedsUpgrade(record, pepper.version + 1), true)
const stored = passwordVerifierForStorage(record)
assert.deepEqual(passwordVerifierFromStorage(stored), record)
assert.equal(passwordVerifierFromStorage({ ...stored, parameters_json: '{}' }), null)
assert.equal(
  passwordVerifierFromStorage({ ...stored, parameters_json: '{"iterations":999999999}' }),
  null,
)
assert.equal(
  await verifyPassword(decomposed.normalize('NFC'), { ...record, iterations: 99 }, pepper),
  false,
)

console.log(
  `identity password policy and ${PASSWORD_KDF_ITERATIONS}-iteration KDF passed (${Math.round(performance.now() - startedAt)} ms)`,
)
