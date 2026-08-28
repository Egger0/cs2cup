import assert from 'node:assert/strict'

import {
  LoginFingerprintError,
  canonicalLoginNetwork,
  fingerprintLoginAccount,
  fingerprintLoginNetwork,
  isValidLoginAccountCandidate,
  resolveLoginClientIpSource,
} from '../lib/login-fingerprint.ts'

const secret = 'login-test-secret-at-least-thirty-two-bytes'
const environment = {
  LOGIN_FINGERPRINT_SECRET: secret,
  LOGIN_CLIENT_IP_SOURCE: 'x-real-ip',
}
const account = 'Admin.CaseSensitive@example.test'
const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'fingerprint-static-canary'
const forceArtifactFailure =
  process.env.AUTH_ARTIFACT_FORCE_FAILURE === 'login-fingerprint'

async function assertSafeRejection(operation, predicate, message) {
  let accepted = false
  try {
    await operation()
  } catch (error) {
    accepted = predicate(error)
  }
  assert.equal(accepted, true, message)
}

const artifactFingerprint = await fingerprintLoginAccount(
  `artifact-account-${artifactCanary}`,
  environment,
)
assert.equal(
  !forceArtifactFailure && /^\\x[0-9a-f]{64}$/.test(artifactFingerprint),
  true,
  'login fingerprint artifact probe failed',
)

assert.equal(isValidLoginAccountCandidate(account), true)
assert.equal(isValidLoginAccountCandidate(` ${account} `), true)
assert.equal(isValidLoginAccountCandidate(''), false)
assert.equal(isValidLoginAccountCandidate('line\nbreak'), false)
assert.equal(isValidLoginAccountCandidate('x'.repeat(513)), false)
assert.equal(isValidLoginAccountCandidate('界'.repeat(171)), false)

const accountFingerprint = await fingerprintLoginAccount(account, environment)
assert.equal(
  accountFingerprint ===
    '\\xcb8da4e6ce92f58bdda065a9d081fbd4828b4f9d4908058a7513e1384b142c17',
  true,
  'account fingerprint vector drifted',
)
assert.equal(/^\\x[0-9a-f]{64}$/.test(accountFingerprint), true)
assert.equal(
  accountFingerprint !==
    await fingerprintLoginAccount(account.toLowerCase(), environment),
  true,
  'account fingerprint unexpectedly case-folded',
)
assert.equal(
  accountFingerprint !==
    await fingerprintLoginAccount(` ${account} `, environment),
  true,
  'account fingerprint unexpectedly trimmed input',
)
assert.equal(
  accountFingerprint !==
    await fingerprintLoginAccount(account, {
      ...environment,
      LOGIN_FINGERPRINT_SECRET: 'different-login-secret-at-least-32-bytes',
    }),
  true,
  'account fingerprint ignored the configured key',
)

for (const invalid of ['', 'line\nbreak', 'x'.repeat(513), null, 1]) {
  assert.equal(
    await fingerprintLoginAccount(invalid, environment) ===
      '\\xc72fa5866c3bf96d3f7f7439f32f5688e2e7ebcbf38563dd459c2b7219844f37',
    true,
    'invalid-account shared fingerprint bucket drifted',
  )
}

for (const [address, expected] of [
  ['203.0.113.10', 'ipv4:203.0.113.10'],
  [' 203.0.113.10 ', 'ipv4:203.0.113.10'],
  ['::ffff:203.0.113.10', 'ipv4:203.0.113.10'],
  ['0:0:0:0:0:ffff:cb00:710a', 'ipv4:203.0.113.10'],
  ['2001:0db8:abcd:0012::1', 'ipv6-64:20010db8abcd0012'],
  ['2001:db8:abcd:12:ffff:ffff:ffff:ffff', 'ipv6-64:20010db8abcd0012'],
]) {
  assert.equal(
    canonicalLoginNetwork(address) === expected,
    true,
    'trusted network canonicalization drifted',
  )
}

for (const invalid of [
  'not-an-ip',
  '203.0.113.01',
  '256.0.0.1',
  '203.0.113.1, 198.51.100.2',
  '2001:db8::1::2',
  '2001:db8:::1',
  'fe80::1%en0',
  '[2001:db8::1]',
]) {
  await assertSafeRejection(
    () => canonicalLoginNetwork(invalid),
    error => error instanceof LoginFingerprintError &&
      error.message === 'Trusted login network is unavailable' &&
      !error.message.includes(invalid),
    'invalid trusted network was not rejected safely',
  )
}

const ipv4Headers = new Headers({ 'x-real-ip': '203.0.113.10' })
assert.equal(
  await fingerprintLoginNetwork(ipv4Headers, environment) ===
    '\\xf2e8012f26a2fa0e9ad3e940ff153fde2363b522f38d574da8b3148198a40c82',
  true,
  'IPv4 network fingerprint vector drifted',
)
assert.equal(
  await fingerprintLoginNetwork(
    new Headers({ 'x-real-ip': '::ffff:203.0.113.10' }),
    environment,
  ) === await fingerprintLoginNetwork(ipv4Headers, environment),
  true,
  'IPv4-mapped fingerprint canonicalization drifted',
)

const firstIpv6 = await fingerprintLoginNetwork(
  new Headers({ 'x-real-ip': '2001:db8:abcd:12::1' }),
  environment,
)
assert.equal(
  firstIpv6 ===
    '\\xdeb333dbb6549c0ae281dc73cad7fa75c73be3b9988215dea7d9938d61b23a51',
  true,
  'IPv6 network fingerprint vector drifted',
)
assert.equal(
  firstIpv6 === await fingerprintLoginNetwork(
    new Headers({ 'x-real-ip': '2001:db8:abcd:12:ffff:ffff:ffff:ffff' }),
    environment,
  ),
  true,
  'IPv6 /64 fingerprint canonicalization drifted',
)
assert.equal(
  firstIpv6 !== await fingerprintLoginNetwork(
    new Headers({ 'x-real-ip': '2001:db8:abcd:13::1' }),
    environment,
  ),
  true,
  'distinct IPv6 /64 networks shared a fingerprint',
)

const cloudflareEnvironment = {
  ...environment,
  LOGIN_CLIENT_IP_SOURCE: 'cf-connecting-ip',
}
assert.equal(
  await fingerprintLoginNetwork(
    new Headers({
      'cf-connecting-ip': '203.0.113.10',
      'x-real-ip': '198.51.100.2',
      'user-agent': 'attacker-controlled',
    }),
    cloudflareEnvironment,
  ) === await fingerprintLoginNetwork(ipv4Headers, environment),
  true,
  'trusted Cloudflare address source drifted',
)
assert.equal(
  await fingerprintLoginNetwork(new Headers(), environment, {
    fallbackAddress: '203.0.113.10',
  }) === await fingerprintLoginNetwork(ipv4Headers, environment),
  true,
  'trusted fallback address handling drifted',
)

assert.equal(resolveLoginClientIpSource(environment), 'x-real-ip')
assert.equal(resolveLoginClientIpSource(cloudflareEnvironment), 'cf-connecting-ip')
for (const invalidEnvironment of [
  {},
  { ...environment, LOGIN_FINGERPRINT_SECRET: 'too-short' },
  { ...environment, LOGIN_FINGERPRINT_SECRET: ` ${secret}` },
  { ...environment, LOGIN_CLIENT_IP_SOURCE: 'x-forwarded-for' },
]) {
  await assertSafeRejection(
    () => fingerprintLoginNetwork(ipv4Headers, invalidEnvironment),
    error => error instanceof LoginFingerprintError &&
      !error.message.includes(secret),
    'invalid fingerprint configuration was not rejected safely',
  )
}

await assertSafeRejection(
  () => fingerprintLoginNetwork(new Headers(), environment),
  error => error instanceof LoginFingerprintError &&
    error.message === 'Trusted login network is unavailable',
  'missing trusted network was not rejected safely',
)

// The same visible value in two dimensions cannot share a digest.
const domainSentinel = 'ipv4:203.0.113.10'
assert.equal(
  await fingerprintLoginAccount(domainSentinel, environment) !==
    await fingerprintLoginNetwork(ipv4Headers, environment),
  true,
  'fingerprint dimensions lost domain separation',
)

console.log('login fingerprint tests passed')
