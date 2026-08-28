import assert from 'node:assert/strict'

import {
  ProviderProofError,
  verifyCloudBasePassword,
} from '../lib/provider-proof.ts'

const environmentId = 'approved-staging'
const issuer = `https://${environmentId}.api.tcloudbasegateway.com/auth/v1`
const environment = {
  CLOUDBASE_ENV_ID: environmentId,
  CLOUDBASE_IDENTITY_ISSUER: issuer,
}
const username = 'Admin.CaseSensitive@example.test'
const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'provider-static-canary'
const artifactFailureMode = process.env.AUTH_ARTIFACT_FORCE_FAILURE
const forceArtifactFailure = artifactFailureMode === 'provider'
const forceTransportArtifactFailure =
  artifactFailureMode === 'provider-transport'
const password = `provider-password-${artifactCanary}`
const token = `provider-access-token-${artifactCanary}`
const subject = `provider-subject-${artifactCanary}`

async function assertSafeRejection(operation, predicate, message) {
  let accepted = false
  try {
    await operation()
  } catch (error) {
    accepted = predicate(error)
  }
  assert.equal(accepted, true, message)
}

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  })
}

function successfulFetch(overrides = {}) {
  const observations = []
  const implementation = async (url, init) => {
    const path = new URL(url).pathname
    observations.push({ url, init })
    if (path === '/auth/v1/signin') {
      return json(overrides.signIn ?? {
        token_type: 'Bearer',
        access_token: token,
        refresh_token: `provider-refresh-token-${artifactCanary}`,
        expires_in: 7_200,
        sub: subject,
      })
    }
    if (path === '/auth/v1/token/introspect') {
      return json(overrides.introspection ?? {
        token_type: 'Bearer',
        client_id: environmentId,
        sub: subject,
        scope: 'openid',
      })
    }
    if (path === '/auth/v1/user/me') {
      return json(overrides.profile ?? {
        sub: subject,
        status: 'ACTIVE',
        email: `provider-profile-${artifactCanary}@example.test`,
      })
    }
    throw new Error('unexpected provider path')
  }
  return { implementation, observations }
}

const success = successfulFetch()
const proof = await verifyCloudBasePassword(
  username,
  password,
  environment,
  success.implementation,
)
assert.equal(
  !forceArtifactFailure &&
    proof.provider === 'cloudbase' &&
    proof.issuer === issuer &&
    proof.subject === subject,
  true,
  'verified provider proof shape drifted',
)
assert.equal(JSON.stringify(proof).includes(token), false)
assert.equal(JSON.stringify(proof).includes(password), false)
assert.equal(success.observations.length, 3)
assert.equal(
  JSON.stringify(
    success.observations.map(entry => new URL(entry.url).pathname),
  ) === JSON.stringify([
    '/auth/v1/signin',
    '/auth/v1/token/introspect',
    '/auth/v1/user/me',
  ]),
  true,
  'provider request sequence drifted',
)
for (const { init } of success.observations) {
  assert.equal(init.redirect, 'error')
  assert.equal(init.cache, 'no-store')
  assert.ok(init.signal instanceof AbortSignal)
}
assert.equal(success.observations[0].init.method, 'POST')
const observedCredentials = JSON.parse(success.observations[0].init.body)
assert.equal(
  observedCredentials.username === username &&
    observedCredentials.password === password &&
    Object.keys(observedCredentials).length === 2,
  true,
  'provider sign-in request shape drifted',
)
for (const { init } of success.observations.slice(1)) {
  assert.equal(init.method, 'GET')
  assert.equal(
    init.headers.Authorization === `Bearer ${token}`,
    true,
    'provider authorization header drifted',
  )
}

for (const invalidEnvironment of [
  {},
  { CLOUDBASE_ENV_ID: environmentId },
  {
    CLOUDBASE_ENV_ID: environmentId,
    CLOUDBASE_IDENTITY_ISSUER: `http://${environmentId}.api.tcloudbasegateway.com/auth/v1`,
  },
  {
    CLOUDBASE_ENV_ID: environmentId,
    CLOUDBASE_IDENTITY_ISSUER: 'https://evil.example/auth/v1',
  },
  {
    CLOUDBASE_ENV_ID: environmentId,
    CLOUDBASE_IDENTITY_ISSUER: `${issuer}#unreviewed`,
  },
  {
    CLOUDBASE_ENV_ID: environmentId,
    CLOUDBASE_IDENTITY_ISSUER:
      `https://${environmentId}.api.tcloudbasegateway.com/${'x'.repeat(600)}`,
  },
]) {
  let called = false
  await assertSafeRejection(
    () => verifyCloudBasePassword(username, password, invalidEnvironment, async () => {
      called = true
      return json({})
    }),
    error => error instanceof ProviderProofError &&
      error.code === 'configuration' &&
      error.message === 'Identity provider is not configured',
    'invalid provider configuration was not rejected safely',
  )
  assert.equal(called, false)
}

const denialCases = [
  { signIn: { token_type: 'bearer', access_token: token, sub: subject } },
  { signIn: { token_type: 'Bearer', access_token: token, sub: 'other-subject' } },
  { introspection: {} },
  {
    introspection: {
      token_type: 'Bearer',
      client_id: 'wrong-environment',
      sub: subject,
    },
  },
  {
    introspection: {
      token_type: 'Bearer',
      client_id: environmentId,
      sub: 'other-subject',
    },
  },
  { profile: { sub: subject, status: 'BLOCKED' } },
  { profile: { sub: 'other-subject', status: 'ACTIVE' } },
]

for (const overrides of denialCases) {
  const failure = successfulFetch(overrides)
  await assertSafeRejection(
    () => verifyCloudBasePassword(
      username,
      password,
      environment,
      failure.implementation,
    ),
    error => error instanceof ProviderProofError &&
      error.code === 'verification' &&
      error.message === 'Identity verification failed' &&
      !error.message.includes(subject) &&
      !error.message.includes(token) &&
      !error.message.includes(password),
    'provider proof mismatch was not rejected safely',
  )
}

for (const response of [
  new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }),
  new Response('{}', { status: 302, headers: { 'Content-Type': 'application/json' } }),
  new Response('<html>not json</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  }),
  new Response('{', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }),
  new Response(`{"padding":"${'x'.repeat(65 * 1_024)}"}`, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }),
]) {
  await assertSafeRejection(
    () => verifyCloudBasePassword(
      username,
      password,
      environment,
      async () => response,
    ),
    error => error instanceof ProviderProofError &&
      error.message === 'Identity verification failed',
    'malformed provider response was not rejected safely',
  )
}

let timeoutAborted = false
await assertSafeRejection(
  () => verifyCloudBasePassword(username, password, environment, async (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        timeoutAborted = true
        reject(new DOMException('provider timeout', 'AbortError'))
      }, { once: true })
    })),
  error => error instanceof ProviderProofError &&
    error.code === 'verification' &&
    error.message === 'Identity verification failed',
  'provider deadline failure was not rejected safely',
)
assert.equal(timeoutAborted, true)

await assertSafeRejection(
  () => verifyCloudBasePassword(username, password, environment, async () => {
    throw new Error(`${token}:${password}:${subject}`)
  }),
  error => error instanceof ProviderProofError &&
    !forceTransportArtifactFailure &&
    !error.message.includes(token) &&
    !error.message.includes(password) &&
    !error.message.includes(subject),
  'provider transport failure was not redacted',
)

console.log('CloudBase provider proof tests passed')
