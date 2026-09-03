import assert from 'node:assert/strict'

import {
  casLoginUrl,
  casServiceUrl,
  completeCasVerification,
  resolveCasVerificationConfig,
} from '../lib/identity/verification/cas.ts'
import { VerificationAdapterError } from '../lib/identity/verification/types.ts'

const state = 'S'.repeat(43)
const input = {
  issuer: 'https://auth.example.edu/cas',
  callbackUrl: 'https://cup.example.edu/auth/callback/cas',
  provider: 'campus-cas',
}
const config = resolveCasVerificationConfig(input)

function expectCode(operation, code) {
  assert.throws(
    operation,
    error => error instanceof VerificationAdapterError && error.code === code,
  )
}

expectCode(
  () => resolveCasVerificationConfig({ ...input, issuer: 'http://auth.example.edu/cas' }),
  'invalid_configuration',
)
expectCode(
  () => resolveCasVerificationConfig({ ...input, issuer: 'https://user@auth.example.edu/cas' }),
  'invalid_configuration',
)
expectCode(
  () => resolveCasVerificationConfig({ ...input, callbackUrl: 'https://cup.example.edu/login' }),
  'invalid_configuration',
)
expectCode(() => casServiceUrl(config, 'not-a-state'), 'invalid_request')

const service = new URL(casServiceUrl(config, state))
assert.equal(service.origin + service.pathname, input.callbackUrl)
assert.equal(service.searchParams.get('state'), state)
const login = new URL(casLoginUrl(config, { state, requirePrimaryCredentials: true }))
assert.equal(login.toString().startsWith(`${input.issuer}/login?`), true)
assert.equal(login.searchParams.get('service'), service.toString())
assert.equal(login.searchParams.get('renew'), 'true')

const xml = subject => `<?xml version="1.0" encoding="UTF-8"?>
<cas:serviceResponse xmlns:cas="http://www.yale.edu/tp/cas">
  <cas:authenticationSuccess><cas:user>${subject}</cas:user></cas:authenticationSuccess>
</cas:serviceResponse>`

function response(body, init = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
    ...init,
  })
}

let requested
let requestInit
const verified = await completeCasVerification(config, {
  state,
  ticket: 'ST-123456-safe-ticket',
  fetch: async (url, init) => {
    requested = new URL(url)
    requestInit = init
    return response(xml('Student&amp;42'))
  },
})
assert.deepEqual(verified, {
  adapterKind: 'cas',
  provider: 'campus-cas',
  issuer: input.issuer,
  subject: 'Student&42',
  displayHint: 'S***42',
  recoveryCapable: true,
})
assert.equal(requested.origin + requested.pathname, `${input.issuer}/serviceValidate`)
assert.equal(requested.searchParams.get('service'), service.toString())
assert.equal(requested.searchParams.get('ticket'), 'ST-123456-safe-ticket')
assert.equal(requestInit.redirect, 'manual')

await assert.rejects(
  completeCasVerification(config, {
    state,
    ticket: 'PT-proxy-ticket',
    fetch: async () => response(xml('student')),
  }),
  error => error instanceof VerificationAdapterError && error.code === 'invalid_request',
)

for (const [body, code] of [
  [
    '<cas:serviceResponse><cas:authenticationFailure code="INVALID_TICKET">no</cas:authenticationFailure></cas:serviceResponse>',
    'provider_rejected',
  ],
  [
    xml('one').replace(
      '</cas:authenticationSuccess>',
      '<cas:user>two</cas:user></cas:authenticationSuccess>',
    ),
    'invalid_provider_response',
  ],
  [
    xml('one').replace(
      '</cas:authenticationSuccess>',
      '<cas:proxies><cas:proxy>https://proxy.example</cas:proxy></cas:proxies></cas:authenticationSuccess>',
    ),
    'invalid_provider_response',
  ],
  [xml('&unknown;'), 'invalid_provider_response'],
  [`<!DOCTYPE x [<!ENTITY y "student">]>${xml('&y;')}`, 'invalid_provider_response'],
]) {
  await assert.rejects(
    completeCasVerification(config, {
      state,
      ticket: 'ST-safe-ticket',
      fetch: async () => response(body),
    }),
    error => error instanceof VerificationAdapterError && error.code === code,
  )
}

for (const badResponse of [
  new Response('', { status: 302, headers: { location: 'https://elsewhere.example' } }),
  new Response(xml('student'), { status: 200, headers: { 'content-type': 'text/html' } }),
  new Response('x', {
    status: 200,
    headers: { 'content-type': 'text/xml', 'content-length': String(64 * 1024 + 1) },
  }),
]) {
  await assert.rejects(
    completeCasVerification(config, {
      state,
      ticket: 'ST-safe-ticket',
      fetch: async () => badResponse,
    }),
    error =>
      error instanceof VerificationAdapterError &&
      ['provider_unavailable', 'invalid_provider_response'].includes(error.code),
  )
}

await assert.rejects(
  completeCasVerification(config, {
    state,
    ticket: 'ST-safe-ticket',
    fetch: async () => {
      throw new Error('network unavailable')
    },
  }),
  error => error instanceof VerificationAdapterError && error.code === 'provider_unavailable',
)

console.log('CAS verification adapter tests passed')
