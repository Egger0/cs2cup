import assert from 'node:assert/strict'

import {
  CsrfError,
  assertCsrfRequest,
  csrfRequestAllowed,
} from '../lib/csrf.ts'

const environment = { NEXT_PUBLIC_SITE_URL: 'https://cup.example' }
const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'csrf-static-canary'
const forceArtifactFailure =
  process.env.AUTH_ARTIFACT_FORCE_FAILURE === 'csrf-redaction'
const request = (method, values = {}) => ({
  method,
  headers: new Headers(values),
})

function assertSafeThrow(operation, predicate, message) {
  let accepted = false
  try {
    operation()
  } catch (error) {
    accepted = predicate(error)
  }
  assert.equal(accepted, true, message)
}

for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
  assert.equal(csrfRequestAllowed(request(method), {}), true)
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  assert.equal(
    csrfRequestAllowed(
      request(method, {
        origin: 'https://cup.example',
        'sec-fetch-site': 'same-origin',
      }),
      environment,
    ),
    true,
  )
}

assert.equal(
  csrfRequestAllowed(
    request('POST', { referer: 'https://cup.example/admin/settings' }),
    environment,
  ),
  true,
)

for (const headers of [
  {},
  { origin: 'null' },
  { origin: 'null', referer: 'https://cup.example/admin' },
  { origin: 'not a URL', referer: 'https://cup.example/admin' },
  { origin: 'https://evil.example' },
  { origin: 'https://cup.example.evil.test' },
  { origin: 'https://cup.example/admin' },
  { origin: 'https://cup.example', 'sec-fetch-site': 'cross-site' },
  { origin: 'https://cup.example', 'sec-fetch-site': 'same-site' },
  { referer: 'https://evil.example/admin' },
  { referer: 'not a URL' },
  { host: 'cup.example', 'x-forwarded-host': 'cup.example' },
]) {
  assert.equal(csrfRequestAllowed(request('POST', headers), environment), false)
}

for (const invalidEnvironment of [
  {},
  { NEXT_PUBLIC_SITE_URL: ' https://cup.example' },
  { NEXT_PUBLIC_SITE_URL: 'file:///tmp/cup' },
  { NEXT_PUBLIC_SITE_URL: 'https://user@cup.example' },
  { NEXT_PUBLIC_SITE_URL: 'https://cup.example/admin' },
]) {
  assertSafeThrow(
    () => assertCsrfRequest(
      request('POST', { origin: 'https://cup.example' }),
      invalidEnvironment,
    ),
    error => error instanceof CsrfError &&
      error.message === 'Request origin could not be verified',
    'invalid CSRF origin configuration was not rejected safely',
  )
}

const denied = request('POST', {
  origin: `https://${artifactCanary}.credential-value.invalid`,
  'sec-fetch-site': 'cross-site',
})
assertSafeThrow(
  () => assertCsrfRequest(denied, environment),
  error => error instanceof CsrfError &&
    !forceArtifactFailure &&
    !error.message.includes('credential-value'),
  'cross-origin CSRF request was not rejected safely',
)

console.log('CSRF boundary tests passed')
