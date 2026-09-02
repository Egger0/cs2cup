import assert from 'node:assert/strict'

import {
  base64UrlToBytes,
  bytesToBase64Url,
  createOpaqueToken,
  hashOpaqueToken,
  isOpaqueToken,
} from '../lib/opaque-token.ts'
import {
  participantAuthenticationOptions,
  participantRegistrationOptions,
} from '../lib/participant-passkeys.ts'

const config = {
  rpName: '宁波理工电竞社',
  rpID: 'localhost',
  origin: 'http://localhost:3000',
}

const tokens = Array.from({ length: 16 }, () => createOpaqueToken())
assert.equal(new Set(tokens).size, tokens.length)
for (const token of tokens) {
  assert.equal(isOpaqueToken(token), true)
  assert.equal(bytesToBase64Url(base64UrlToBytes(token)), token)
  assert.match(await hashOpaqueToken(token), /^[0-9a-f]{64}$/)
}

const registrationChallenge = createOpaqueToken()
const userHandle = createOpaqueToken()
const registration = await participantRegistrationOptions({
  config,
  challenge: registrationChallenge,
  userHandle,
  accountLabel: 'AAA · Alpha',
  displayLabel: '秋季杯 / AAA',
})
assert.equal(registration.challenge, registrationChallenge)
assert.equal(registration.rp.id, 'localhost')
assert.equal(registration.user.id, userHandle)
assert.equal(registration.attestation, 'none')
assert.equal(registration.authenticatorSelection?.residentKey, 'required')
assert.equal(registration.authenticatorSelection?.userVerification, 'required')

const authenticationChallenge = createOpaqueToken()
const authentication = await participantAuthenticationOptions({
  config,
  challenge: authenticationChallenge,
})
assert.equal(authentication.challenge, authenticationChallenge)
assert.equal(authentication.rpId, 'localhost')
assert.deepEqual(authentication.allowCredentials, [])
assert.equal(authentication.userVerification, 'required')

console.log('participant passkey option and opaque token tests passed')
