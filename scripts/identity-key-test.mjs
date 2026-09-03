import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'

import {
  hashVerifiedIdentityKey,
  resolveIdentityKeyConfig,
} from '../lib/identity/verification/identity-key.ts'
import { bytesToBase64Url } from '../lib/opaque-token.ts'
import { VerificationAdapterError } from '../lib/identity/verification/types.ts'

if (!globalThis.crypto) globalThis.crypto = webcrypto

const key = bytesToBase64Url(Uint8Array.from({ length: 32 }, (_, index) => index))
const config = resolveIdentityKeyConfig({ encodedKey: key })
const alpha = { provider: 'campus-cas', issuer: 'https://id.example/cas', subject: 'student-1' }
const bravo = { ...alpha, subject: 'student-2' }

const first = await hashVerifiedIdentityKey(config, alpha)
assert.match(first, /^[0-9a-f]{64}$/)
assert.equal(await hashVerifiedIdentityKey(config, alpha), first)
assert.notEqual(await hashVerifiedIdentityKey(config, bravo), first)
assert.notEqual(await hashVerifiedIdentityKey({ ...config, version: 2 }, alpha), first)

for (const encodedKey of ['', 'bad', bytesToBase64Url(new Uint8Array(31))]) {
  assert.throws(
    () => resolveIdentityKeyConfig({ encodedKey }),
    error => error instanceof VerificationAdapterError && error.code === 'invalid_configuration',
  )
}
await assert.rejects(
  hashVerifiedIdentityKey(config, { ...alpha, provider: 'Campus' }),
  error => error instanceof VerificationAdapterError && error.code === 'invalid_provider_response',
)
await assert.rejects(
  hashVerifiedIdentityKey(config, { ...alpha, subject: ' student-1' }),
  error => error instanceof VerificationAdapterError && error.code === 'invalid_provider_response',
)

console.log('verified identity key tests passed')
