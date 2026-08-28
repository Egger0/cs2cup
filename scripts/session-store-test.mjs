import assert from 'node:assert/strict'

import {
  SessionStoreError,
  admitAdminApplicationSession,
  authorizeAdminPrincipal,
  clearLoginAccountThrottle,
  consumeLoginAttempt,
  createSessionRequestId,
  logoutApplicationSession,
  validateApplicationSession,
} from '../lib/session-store.ts'

const requestId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const principalId = '33333333-3333-4333-8333-333333333333'
const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'session-static-canary'
const artifactFailureMode = process.env.AUTH_ARTIFACT_FORCE_FAILURE
const forceArtifactFailure = artifactFailureMode === 'session-store'
const forceTransportArtifactFailure =
  artifactFailureMode === 'session-store-transport'
const token = `v1.${'A'.repeat(43)}`
const replacementToken = `v1.${'A'.repeat(42)}E`
const digest = '\\xdf4e1ae894615d0aaa4fb926759ad877c85f0fecd2fa6c8ddaa0b0b2109573d7'
const fingerprint = `\\x${'ab'.repeat(32)}`
const envelope = {
  ok: true,
  sessionId,
  principalId,
  idleExpiresAt: '2026-08-28T08:30:00.000Z',
  absoluteExpiresAt: '2026-08-28T16:00:00.000Z',
  rotateAfter: '2026-08-28T08:15:00.000Z',
}
const proof = {
  provider: 'cloudbase',
  issuer: `https://approved.api.tcloudbasegateway.com/auth/v1/${artifactCanary}`,
  subject: `verified-subject-${artifactCanary}`,
}

async function assertSafeRejection(operation, predicate, message) {
  let accepted = false
  try {
    await operation()
  } catch (error) {
    accepted = predicate(error)
  }
  assert.equal(accepted, true, message)
}

const calls = []
const rpc = async (name, args) => {
  calls.push({ name, args })
  if (name === 'admit_admin_app_session') return envelope
  if (name === 'use_app_session') return { ...envelope, status: 'active' }
  if (name === 'logout_app_session') return { ok: true, revoked: true }
  if (name === 'authorize_admin_principal') return { ok: true, authorized: true }
  if (name === 'consume_login_attempt') {
    return { ok: true, allowed: false, retryAfterSeconds: 17 }
  }
  if (name === 'clear_login_account_throttle') return { ok: true, cleared: true }
  throw new Error('unexpected RPC')
}

const admission = await admitAdminApplicationSession(proof, {
  candidateToken: token,
  requestId,
  rpc,
})
assert.equal(
  !forceArtifactFailure &&
    JSON.stringify(admission) === JSON.stringify({ ...envelope, token }),
  true,
  'session admission response shape drifted',
)
const admissionCall = calls.shift()
assert.equal(
  admissionCall?.name === 'admit_admin_app_session' &&
    admissionCall.args.p_provider === 'cloudbase' &&
    admissionCall.args.p_issuer === proof.issuer &&
    admissionCall.args.p_subject === proof.subject &&
    admissionCall.args.p_token_hash === digest &&
    admissionCall.args.p_request_id === requestId &&
    Object.keys(admissionCall.args).length === 5,
  true,
  'session admission RPC shape drifted',
)
assert.equal(JSON.stringify(calls).includes(token), false)

const deniedAdmission = await admitAdminApplicationSession(proof, {
  candidateToken: token,
  requestId,
  rpc: async () => ({ ok: false }),
})
assert.deepEqual(deniedAdmission, { ok: false })
assert.equal('token' in deniedAdmission, false)

for (const invalidProof of [null, undefined, [], {}, { provider: 'cloudbase' }]) {
  await assertSafeRejection(
    () => admitAdminApplicationSession(invalidProof, {
      candidateToken: token,
      requestId,
      rpc,
    }),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_input' &&
      error.message === 'Invalid session service input',
    'invalid provider proof was not rejected safely',
  )
}

for (const status of ['active', 'grace', 'rotated']) {
  const result = await validateApplicationSession(token, {
    replacementToken,
    requestId,
    rpc: async (name, args) => {
      assert.equal(name, 'use_app_session')
      assert.equal(
        args.p_token_hash === digest,
        true,
        'presented session digest drifted',
      )
      assert.equal(
        /^\\x[0-9a-f]{64}$/.test(String(args.p_replacement_hash)),
        true,
        'replacement session digest shape drifted',
      )
      assert.equal(
        args.p_replacement_hash !== digest,
        true,
        'replacement session digest was not independent',
      )
      assert.equal(
        args.p_request_id === requestId,
        true,
        'session request identifier drifted',
      )
      assert.equal(JSON.stringify(args).includes(token), false)
      assert.equal(JSON.stringify(args).includes(replacementToken), false)
      return { ...envelope, status }
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.status, status)
  assert.equal(
    ('replacementToken' in result ? result.replacementToken : undefined) ===
      (status === 'rotated' ? replacementToken : undefined),
    true,
    'replacement session credential exposure drifted',
  )
}

const deniedUse = await validateApplicationSession(token, {
  replacementToken,
  requestId,
  rpc: async () => ({ ok: false }),
})
assert.deepEqual(deniedUse, { ok: false })
assert.equal('replacementToken' in deniedUse, false)

assert.deepEqual(
  await logoutApplicationSession(token, { requestId, rpc }),
  { ok: true, revoked: true },
)
const logoutCall = calls.shift()
assert.equal(
  logoutCall?.name === 'logout_app_session' &&
    logoutCall.args.p_token_hash === digest &&
    logoutCall.args.p_request_id === requestId &&
    Object.keys(logoutCall.args).length === 2,
  true,
  'session logout RPC shape drifted',
)
assert.equal(await authorizeAdminPrincipal(principalId, { rpc }), true)
const authorizationCall = calls.shift()
assert.equal(
  authorizationCall?.name === 'authorize_admin_principal' &&
    authorizationCall.args.p_principal_id === principalId &&
    Object.keys(authorizationCall.args).length === 1,
  true,
  'administrator authorization RPC shape drifted',
)
assert.equal(
  await authorizeAdminPrincipal(principalId, {
    rpc: async () => ({ ok: true, authorized: false }),
  }),
  false,
)
assert.deepEqual(
  await consumeLoginAttempt(fingerprint, fingerprint, { rpc }),
  { allowed: false, retryAfterSeconds: 17 },
)
const throttleCall = calls.shift()
assert.equal(
  throttleCall?.name === 'consume_login_attempt' &&
    throttleCall.args.p_account_fingerprint === fingerprint &&
    throttleCall.args.p_network_fingerprint === fingerprint &&
    Object.keys(throttleCall.args).length === 2,
  true,
  'login throttle RPC shape drifted',
)
assert.equal(await clearLoginAccountThrottle(fingerprint, { rpc }), true)
const throttleClearCall = calls.shift()
assert.equal(
  throttleClearCall?.name === 'clear_login_account_throttle' &&
    throttleClearCall.args.p_account_fingerprint === fingerprint &&
    Object.keys(throttleClearCall.args).length === 1,
  true,
  'login throttle clear RPC shape drifted',
)
assert.equal(calls.length, 0)
assert.equal(
  await logoutApplicationSession(token, {
    requestId,
    rpc: async () => ({ ok: true, revoked: false }),
  }).then(result => result.revoked),
  false,
)
assert.equal(
  await clearLoginAccountThrottle(fingerprint, {
    rpc: async () => ({ ok: true, cleared: false }),
  }),
  false,
)

for (const response of [
  null,
  { ok: false, authorized: false },
  { ok: true, authorized: 'true' },
]) {
  await assertSafeRejection(
    () => authorizeAdminPrincipal(principalId, { rpc: async () => response }),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_response',
    'malformed authorization response was not rejected safely',
  )
}

const authorizationTransportSecret =
  `authorization-${artifactCanary}-transport-secret`
await assertSafeRejection(
  () => authorizeAdminPrincipal(principalId, {
    rpc: async () => {
      throw new Error(authorizationTransportSecret)
    },
  }),
  error => error instanceof SessionStoreError &&
    !forceTransportArtifactFailure &&
    error.code === 'unavailable' &&
    !error.message.includes(authorizationTransportSecret) &&
    !('cause' in error),
  'authorization transport failure was not redacted',
)

const forgedTransportError = new SessionStoreError('unavailable')
forgedTransportError.message = `forged-${artifactCanary}-transport-message`
forgedTransportError.cause = new Error(authorizationTransportSecret)
await assertSafeRejection(
  () => authorizeAdminPrincipal(principalId, {
    rpc: async () => {
      throw forgedTransportError
    },
  }),
  error => error instanceof SessionStoreError &&
    error !== forgedTransportError &&
    error.code === 'unavailable' &&
    error.message === 'Session service is unavailable' &&
    !error.message.includes(artifactCanary) &&
    !('cause' in error),
  'forged session-store error was not redacted',
)

let timeoutSignalObserved = false
await assertSafeRejection(
  () => authorizeAdminPrincipal(principalId, {
    rpcTimeoutMs: 10,
    rpc: async (_name, _args, signal) =>
      new Promise((_resolve, reject) => {
        assert.equal(signal.aborted, false)
        signal.addEventListener('abort', () => {
          timeoutSignalObserved = true
          reject(new Error(authorizationTransportSecret))
        }, { once: true })
      }),
  }),
  error => error instanceof SessionStoreError &&
    error.code === 'unavailable' &&
    error.message === 'Session service is unavailable' &&
    !error.message.includes(authorizationTransportSecret) &&
    !('cause' in error),
  'session-store deadline failure was not redacted',
)
assert.equal(timeoutSignalObserved, true)

let lateTransportRejected = false
const unhandledRejections = []
const captureUnhandledRejection = reason => unhandledRejections.push(reason)
process.on('unhandledRejection', captureUnhandledRejection)
try {
  await assertSafeRejection(
    () => authorizeAdminPrincipal(principalId, {
      rpcTimeoutMs: 10,
      rpc: async () => new Promise((_resolve, reject) => {
        setTimeout(() => {
          lateTransportRejected = true
          reject(new Error(`late-${artifactCanary}-transport-error`))
        }, 25)
      }),
    }),
    error => error instanceof SessionStoreError &&
      error.code === 'unavailable' &&
      error.message === 'Session service is unavailable' &&
      !('cause' in error),
    'late session-store rejection was not contained',
  )
  await new Promise(resolve => setTimeout(resolve, 30))
} finally {
  process.off('unhandledRejection', captureUnhandledRejection)
}
assert.equal(lateTransportRejected, true)
assert.equal(unhandledRejections.length, 0)

const originalFetch = globalThis.fetch
const originalAdminEndpoint = process.env.RDB_ADMIN_BASE_URL
let defaultTransportSignalObserved = false
try {
  process.env.RDB_ADMIN_BASE_URL = 'http://127.0.0.1:9/v1/rdb/rest'
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) => {
      assert.ok(init.signal instanceof AbortSignal)
      init.signal.addEventListener('abort', () => {
        defaultTransportSignalObserved = true
        reject(new Error(authorizationTransportSecret))
      }, { once: true })
    })
  await assertSafeRejection(
    () => authorizeAdminPrincipal(principalId, { rpcTimeoutMs: 10 }),
    error => error instanceof SessionStoreError &&
      error.code === 'unavailable' &&
      error.message === 'Session service is unavailable' &&
      !error.message.includes(authorizationTransportSecret) &&
      !('cause' in error),
    'default session transport failure was not redacted',
  )
  assert.equal(defaultTransportSignalObserved, true)
} finally {
  globalThis.fetch = originalFetch
  if (originalAdminEndpoint === undefined) delete process.env.RDB_ADMIN_BASE_URL
  else process.env.RDB_ADMIN_BASE_URL = originalAdminEndpoint
}

for (const rpcTimeoutMs of [0, -1, 1.5, 30_001, Number.NaN]) {
  let called = false
  await assertSafeRejection(
    () => authorizeAdminPrincipal(principalId, {
      rpcTimeoutMs,
      rpc: async () => {
        called = true
        return { ok: true, authorized: true }
      },
    }),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_input',
    'invalid session-store deadline was not rejected safely',
  )
  assert.equal(called, false)
}

for (const operation of [
  () => logoutApplicationSession(token, {
    requestId,
    rpc: async () => ({ ok: true, revoked: 'true' }),
  }),
  () => clearLoginAccountThrottle(fingerprint, {
    rpc: async () => ({ ok: true, cleared: 'true' }),
  }),
]) {
  await assertSafeRejection(
    operation,
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_response',
    'malformed session operation response was not rejected safely',
  )
}

const generatedRequestIds = new Set(
  Array.from({ length: 256 }, () => createSessionRequestId()),
)
assert.equal(generatedRequestIds.size, 256)
for (const value of generatedRequestIds) {
  assert.equal(
    /^[0-9a-f-]{36}$/.test(value),
    true,
    'generated request identifier shape drifted',
  )
}

const invalidResponses = [
  null,
  [],
  {},
  { ok: 'true' },
  { ...envelope, status: 'unknown' },
  { ...envelope, sessionId: 'not-a-uuid', status: 'active' },
  { ...envelope, idleExpiresAt: '0', status: 'active' },
  { ...envelope, idleExpiresAt: '2026-02-29T08:00:00Z', status: 'active' },
  { ...envelope, idleExpiresAt: '2026-04-31T08:00:00Z', status: 'active' },
  { ...envelope, idleExpiresAt: '2026-08-28T24:00:00Z', status: 'active' },
  { ...envelope, idleExpiresAt: '2026-08-28T08:00:00+24:00', status: 'active' },
  { ...envelope, idleExpiresAt: '2026-08-28T08:00:00+00:60', status: 'active' },
  {
    ...envelope,
    idleExpiresAt: '2026-08-28T16:00:00.000002Z',
    absoluteExpiresAt: '2026-08-28T16:00:00.000001Z',
    status: 'active',
  },
  {
    ...envelope,
    idleExpiresAt: '2026-08-29T00:00:00.000Z',
    status: 'active',
  },
]
for (const response of invalidResponses) {
  await assertSafeRejection(
    () => validateApplicationSession(token, {
      replacementToken,
      requestId,
      rpc: async () => response,
    }),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_response' &&
      !error.message.includes(token),
    'malformed session-use response was not rejected safely',
  )
}

for (const invalid of [
  'not-a-session-token',
  `v1.${'A'.repeat(42)}B`,
  `${token}credential-sentinel`,
]) {
  await assertSafeRejection(
    () => validateApplicationSession(
      invalid,
      { replacementToken, requestId, rpc },
    ),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_input' &&
      !error.message.includes('credential-sentinel'),
    'invalid session credential was not rejected safely',
  )
}
await assertSafeRejection(
  () => validateApplicationSession(token, {
    replacementToken: token,
    requestId,
    rpc,
  }),
  error => error instanceof SessionStoreError && error.code === 'invalid_input',
  'reused replacement credential was not rejected safely',
)
await assertSafeRejection(
  () => consumeLoginAttempt(`${fingerprint}secret`, fingerprint, { rpc }),
  error => error instanceof SessionStoreError &&
    error.code === 'invalid_input' &&
    !error.message.includes('secret'),
  'invalid login fingerprint was not rejected safely',
)
for (const response of [
  { ok: true, allowed: true, retryAfterSeconds: 1 },
  { ok: true, allowed: false, retryAfterSeconds: 0 },
  { ok: true, allowed: false, retryAfterSeconds: 901 },
  { ok: true, allowed: false, retryAfterSeconds: Number.MAX_SAFE_INTEGER + 1 },
]) {
  await assertSafeRejection(
    () => consumeLoginAttempt(fingerprint, fingerprint, {
      rpc: async () => response,
    }),
    error => error instanceof SessionStoreError &&
      error.code === 'invalid_response',
    'malformed login throttle response was not rejected safely',
  )
}

assert.deepEqual(
  await consumeLoginAttempt(fingerprint, fingerprint, {
    rpc: async () => ({ ok: true, allowed: false, retryAfterSeconds: 900 }),
  }),
  { allowed: false, retryAfterSeconds: 900 },
)

const transportSecret = `database-diagnostic-${artifactCanary}-with-token-material`
const unavailable = async () => {
  throw new Error(transportSecret)
}
await assertSafeRejection(
  () => admitAdminApplicationSession(proof, {
    candidateToken: token,
    requestId,
    rpc: unavailable,
  }),
  error => error instanceof SessionStoreError &&
    error.code === 'unavailable' &&
    error.message === 'Session service is unavailable' &&
    !error.message.includes(transportSecret) &&
    !('cause' in error),
  'session admission transport failure was not redacted',
)

console.log('application session store adapter tests passed')
