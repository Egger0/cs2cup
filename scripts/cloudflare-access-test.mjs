import assert from 'node:assert/strict'

import {
  SignJWT,
  exportJWK,
  generateKeyPair,
} from 'jose'

import {
  CloudflareAccessError,
  accessJwtFromHeaders,
  verifyAccessJwt,
  verifyAccessRequest,
} from '../lib/cloudflare-access.ts'

const issuer = 'https://cs2cup-test.cloudflareaccess.com'
const audience = 'cs2cup-admin-audience'
const environment = {
  CF_ACCESS_ISSUER: issuer,
  CF_ACCESS_AUDIENCE: audience,
}
const { publicKey, privateKey } = await generateKeyPair('RS256', {
  extractable: true,
})
const { privateKey: unrelatedPrivateKey } = await generateKeyPair('RS256')
const jwk = await exportJWK(publicKey)
Object.assign(jwk, { alg: 'RS256', kid: 'access-test', use: 'sig' })

const originalFetch = globalThis.fetch
const fetches = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  fetches.push({ url, init })
  if (url.includes('unavailable.cloudflareaccess.com')) {
    throw new Error('jwks-transport-secret-must-not-escape')
  }
  assert.equal(url, `${issuer}/cdn-cgi/access/certs`)
  assert.equal(init?.method, 'GET')
  assert.equal(init?.redirect, 'manual')
  return Response.json({ keys: [jwk] })
}

const sign = (options = {}) => {
  const {
    signingKey = privateKey,
    tokenIssuer = issuer,
    tokenAudience = audience,
    expiration = '5m',
    algorithm = 'RS256',
  } = options
  const subject = Object.hasOwn(options, 'subject')
    ? options.subject
    : 'access-user-123'
  const email = Object.hasOwn(options, 'email')
    ? options.email
    : 'admin@example.test'
  const claims = { aud: tokenAudience, ...(email === undefined ? {} : { email }) }
  if (subject !== undefined) claims.sub = subject
  return new SignJWT(claims)
    .setProtectedHeader({ alg: algorithm, kid: 'access-test' })
    .setIssuer(tokenIssuer)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(signingKey)
}

try {
  const valid = await sign()
  assert.deepEqual(await verifyAccessJwt(valid, environment), {
    uid: 'access-user-123',
    email: 'admin@example.test',
  })
  assert.deepEqual(await verifyAccessJwt(valid, environment), {
    uid: 'access-user-123',
    email: 'admin@example.test',
  })
  assert.equal(fetches.filter(call => call.url === `${issuer}/cdn-cgi/access/certs`).length, 1)

  for (const [name, invalid] of [
    ['malformed JWT', 'not-a-jwt'],
    ['wrong issuer', await sign({ tokenIssuer: 'https://other.cloudflareaccess.com' })],
    ['wrong audience', await sign({ tokenAudience: 'wrong-audience' })],
    ['expired JWT', await sign({ expiration: 0 })],
    ['wrong signing key', await sign({ signingKey: unrelatedPrivateKey })],
    ['missing subject', await sign({ subject: undefined })],
    ['anonymous subject', await sign({ subject: 'anon' })],
    ['invalid email', await sign({ email: ' invalid@example.test' })],
  ]) {
    assert.equal(await verifyAccessJwt(invalid, environment), null, name)
  }

  const assertionHeaders = new Headers({ 'Cf-Access-Jwt-Assertion': valid })
  assert.equal(accessJwtFromHeaders(assertionHeaders), valid)
  assert.deepEqual(await verifyAccessRequest(assertionHeaders, environment), {
    uid: 'access-user-123',
    email: 'admin@example.test',
  })

  const cookieToken = await sign({ subject: 'cookie-user', email: undefined })
  const cookieHeaders = new Headers({ Cookie: `CF_Authorization=${cookieToken}` })
  assert.equal(accessJwtFromHeaders(cookieHeaders), null)
  assert.equal(await verifyAccessRequest(cookieHeaders, environment), null)

  const badAssertion = new Headers({
    'Cf-Access-Jwt-Assertion': 'invalid-assertion',
    Cookie: `CF_Authorization=${valid}`,
  })
  assert.equal(accessJwtFromHeaders(badAssertion), 'invalid-assertion')
  assert.equal(await verifyAccessRequest(badAssertion, environment), null)

  await assert.rejects(
    verifyAccessJwt(valid, {}),
    error => error instanceof CloudflareAccessError &&
      error.code === 'configuration' &&
      !('cause' in error),
  )

  const unavailableEnvironment = {
    CF_ACCESS_ISSUER: 'https://unavailable.cloudflareaccess.com',
    CF_ACCESS_AUDIENCE: audience,
  }
  await assert.rejects(
    verifyAccessJwt(valid, unavailableEnvironment),
    error => error instanceof CloudflareAccessError &&
      error.code === 'unavailable' &&
      !error.message.includes('transport-secret') &&
      !('cause' in error),
  )
} finally {
  globalThis.fetch = originalFetch
}

console.log('Cloudflare Access verification tests passed')
