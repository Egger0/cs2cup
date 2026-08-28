import assert from 'node:assert/strict'

import {
  assertCanonicalSessionToken,
  digestSessionToken,
  generateSessionToken,
  isCanonicalSessionToken,
} from '../lib/session-token.ts'

const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/
const ZERO_BYTES_TOKEN = `v1.${'A'.repeat(43)}`
const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'token-static-canary'
const artifactFailureMode = process.env.AUTH_ARTIFACT_FORCE_FAILURE
const forceArtifactFailure = artifactFailureMode === 'session-token'
const forceRedactionFailure = artifactFailureMode === 'session-token-redaction'

async function assertSafeRejection(operation, predicate, message) {
  let accepted = false
  try {
    await operation()
  } catch (error) {
    accepted = predicate(error)
  }
  assert.equal(accepted, true, message)
}

const generated = generateSessionToken()
assert.equal(generated.length, 46)
assert.equal(
  !forceArtifactFailure && TOKEN_PATTERN.test(generated),
  true,
  'generated session credential shape drifted',
)
assert.equal(isCanonicalSessionToken(generated), true)
assert.doesNotThrow(() => assertCanonicalSessionToken(generated))

const generatedTokens = new Set(
  Array.from({ length: 1_024 }, () => generateSessionToken()),
)
assert.equal(generatedTokens.size, 1_024)
for (const token of generatedTokens) {
  assert.equal(
    TOKEN_PATTERN.test(token),
    true,
    'generated session credential shape drifted',
  )
  assert.equal(isCanonicalSessionToken(token), true)
}

for (const finalCharacter of 'AEIMQUYcgkosw048') {
  assert.equal(
    isCanonicalSessionToken(`v1.${'A'.repeat(42)}${finalCharacter}`),
    true,
  )
}

const invalidTokens = [
  null,
  undefined,
  1,
  {},
  '',
  ZERO_BYTES_TOKEN.slice(3),
  `v2.${'A'.repeat(43)}`,
  `V1.${'A'.repeat(43)}`,
  `v1.${'A'.repeat(42)}`,
  `v1.${'A'.repeat(44)}`,
  `v1.${'A'.repeat(42)}=`,
  `v1.${'A'.repeat(42)}+`,
  `v1.${'A'.repeat(42)}/`,
  ` ${ZERO_BYTES_TOKEN}`,
  `${ZERO_BYTES_TOKEN} `,
  `${ZERO_BYTES_TOKEN}\n`,
  `v1.${'A'.repeat(42)}é`,
  // B, C, and D differ only in the two unused low bits from canonical A.
  `v1.${'A'.repeat(42)}B`,
  `v1.${'A'.repeat(42)}C`,
  `v1.${'A'.repeat(42)}D`,
]

for (const token of invalidTokens) {
  assert.equal(isCanonicalSessionToken(token), false)
  await assertSafeRejection(
    () => assertCanonicalSessionToken(token),
    error =>
      error instanceof TypeError &&
      error.message === 'Invalid session token',
    'invalid session credential was not rejected safely',
  )
}

const invalidSecret = `v1.${'A'.repeat(42)}!${artifactCanary}-do-not-echo`
await assertSafeRejection(
  () => assertCanonicalSessionToken(invalidSecret),
  error =>
    error instanceof TypeError &&
    !forceRedactionFailure &&
    error.message === 'Invalid session token' &&
    !error.message.includes(invalidSecret),
  'invalid session credential diagnostic was not redacted',
)

await assertSafeRejection(
  () => digestSessionToken(`v1.${'A'.repeat(42)}B`),
  error => error instanceof TypeError &&
    error.message === 'Invalid session token',
  'invalid session digest input was not rejected safely',
)

// These vectors were calculated independently with OpenSSL. The accepted
// digest includes both the domain and the complete versioned token.
const digest = await digestSessionToken(ZERO_BYTES_TOKEN)
assert.equal(
  digest ===
    '\\xdf4e1ae894615d0aaa4fb926759ad877c85f0fecd2fa6c8ddaa0b0b2109573d7',
  true,
  'session digest vector drifted',
)
assert.equal(/^\\x[0-9a-f]{64}$/.test(digest), true)
assert.equal(await digestSessionToken(ZERO_BYTES_TOKEN) === digest, true)

// Neither dropping the token version nor changing the domain may collide with
// the contract digest.
assert.equal(
  digest !==
    '\\x31fafde7d9ae3a1fec40cdbb9f0700b27227942fb256911f9d5ee5c9af007f3',
  true,
  'session digest omitted its version',
)
assert.equal(
  digest !==
    '\\x0fdda0bd5403bf3702c00de615df00ce22610422a85a252420b60c5b81122da2',
  true,
  'session digest lost domain separation',
)
assert.equal(
  await digestSessionToken(generateSessionToken()) !== digest,
  true,
  'independent session credentials shared a digest',
)

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
try {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: undefined,
  })
  await assertSafeRejection(
    generateSessionToken,
    error => error instanceof Error &&
      error.message === 'Web Crypto is unavailable',
    'missing Web Crypto did not fail session generation safely',
  )
  await assertSafeRejection(
    () => digestSessionToken(ZERO_BYTES_TOKEN),
    error => error instanceof Error &&
      error.message === 'Web Crypto is unavailable',
    'missing Web Crypto did not fail session digest safely',
  )
} finally {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
  } else {
    delete globalThis.crypto
  }
}

console.log('session token codec tests passed')
