import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie transport') }`,
)
const bindingsModule = dataModule(
  `export function cloudflareBindings() { throw new Error('Unexpected production binding') }`,
)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts') {
      return { url: bindingsModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')
const { getAuthContext } = await import('../lib/identity/kernel.ts')
const { hashOpaqueToken } = await import('../lib/opaque-token.ts')
const { completePasskeyAuthentication, passkeyAuthenticationCredential } =
  await import('../lib/identity/internal/passkey-authentication.ts')
const { listAccountPasskeys, revokeAccountPasskey } =
  await import('../lib/identity/internal/passkey-credentials.ts')
const { claimPasskeyEnrollmentAttempt, completePasskeyEnrollment, preparePasskeyEnrollment } =
  await import('../lib/identity/internal/passkey-enrollment.ts')
const { claimPasskeyIntentAttempt, issuePasskeyIntent } =
  await import('../lib/identity/internal/passkey-intent.ts')
const { IdentityPasskeyError } = await import('../lib/identity/internal/passkey-shared.ts')

const fixture = await createIdentityKernelFixture()
const { database, db, execute } = fixture
const base = fixture.now

async function expectPasskeyError(operation, code) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof IdentityPasskeyError)
    assert.equal(error.code, code)
    return true
  })
}

try {
  const replaced = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    base,
  )
  const signIn = await issuePasskeyIntent(db, {
    purpose: 'passkey_sign_in',
    redirectKey: 'account',
    context: {},
    now: base + 1,
  })
  const rawIntent = database
    .prepare(
      `SELECT secret_hash, passkey_challenge_hash, attempt_count, max_attempts
       FROM identity_auth_intent WHERE id = ?`,
    )
    .get(signIn.id)
  assert.equal(rawIntent.secret_hash, await hashOpaqueToken(signIn.secret))
  assert.equal(rawIntent.passkey_challenge_hash, await hashOpaqueToken(signIn.challenge))
  assert.notEqual(rawIntent.secret_hash, rawIntent.passkey_challenge_hash)
  assert.equal(rawIntent.attempt_count, 0)
  assert.equal(rawIntent.max_attempts, 5)

  const attempt = await claimPasskeyIntentAttempt(db, {
    purpose: 'passkey_sign_in',
    secret: signIn.secret,
    now: base + 2,
  })
  const credential = await passkeyAuthenticationCredential(db, credentialIds.owner)
  const authenticated = await completePasskeyAuthentication(db, {
    intent: attempt,
    credential,
    verification: { newCounter: 1, deviceType: 'multiDevice', backedUp: true },
    replacement: { unifiedTokenHash: replaced.draft.record.tokenHash },
    now: base + 3,
  })
  const context = await getAuthContext({ database: db, token: authenticated.token, now: base + 3 })
  assert.equal(context.kind, 'authenticated')
  assert.equal(context.kind === 'authenticated' && context.account.id, accountIds.owner)
  assert.equal(context.kind === 'authenticated' && context.session.authMethod, 'passkey')
  assert.equal(
    database
      .prepare('SELECT revoked_at FROM identity_session WHERE id = ?')
      .get(replaced.draft.record.id).revoked_at,
    base + 3,
  )
  assert.equal(
    database.prepare('SELECT consumed_at FROM identity_auth_intent WHERE id = ?').get(signIn.id)
      .consumed_at,
    base + 3,
  )
  await expectPasskeyError(
    () =>
      claimPasskeyIntentAttempt(db, {
        purpose: 'passkey_sign_in',
        secret: signIn.secret,
        now: base + 4,
      }),
    'invalid_ceremony',
  )

  const staleIntent = await issuePasskeyIntent(db, {
    purpose: 'passkey_sign_in',
    redirectKey: 'account',
    context: {},
    now: base + 10,
  })
  const staleAttempt = await claimPasskeyIntentAttempt(db, {
    purpose: 'passkey_sign_in',
    secret: staleIntent.secret,
    now: base + 11,
  })
  const staleCredential = await passkeyAuthenticationCredential(db, credentialIds.owner)
  execute(
    `UPDATE identity_passkey_credential
     SET counter = 2, last_used_at = ?, revision = revision + 1, write_nonce = ?
     WHERE credential_id = ?`,
    [base + 12, 'Z'.repeat(43), credentialIds.owner],
  )
  await expectPasskeyError(
    () =>
      completePasskeyAuthentication(db, {
        intent: staleAttempt,
        credential: staleCredential,
        verification: { newCounter: 2, deviceType: 'multiDevice', backedUp: true },
        now: base + 13,
      }),
    'conflict',
  )
  assert.equal(
    database
      .prepare('SELECT consumed_at FROM identity_auth_intent WHERE id = ?')
      .get(staleIntent.id).consumed_at,
    null,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_session WHERE passkey_auth_intent_id = ?')
      .get(staleIntent.id).count,
    0,
  )

  const enrollmentSession = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    base + 20,
  )
  const prepared = await preparePasskeyEnrollment(db, {
    context: enrollmentSession.context,
    label: 'MacBook Touch ID',
    now: base + 21,
  })
  assert.equal(
    database
      .prepare(
        `SELECT initiating_session_id FROM identity_passkey_enrollment_authorization
         WHERE auth_intent_id = ?`,
      )
      .get(prepared.intent.id).initiating_session_id,
    enrollmentSession.context.session.id,
  )
  const enrollmentAttempt = await claimPasskeyEnrollmentAttempt(db, {
    context: enrollmentSession.context,
    secret: prepared.intent.secret,
    now: base + 22,
  })
  const enrolled = await completePasskeyEnrollment(db, {
    context: enrollmentSession.context,
    intent: enrollmentAttempt,
    registration: {
      credential: {
        id: 'identity_test_credential',
        publicKey: Uint8Array.from([1, 2, 3, 4]),
        counter: 0,
        transports: ['internal'],
      },
      deviceType: 'multiDevice',
      backedUp: true,
    },
    now: base + 23,
  })
  assert.equal(enrolled.label, 'MacBook Touch ID')
  assert.deepEqual(
    (await listAccountPasskeys(db, enrollmentSession.context, base + 24)).map(
      item => item.credentialId,
    ),
    ['identity_test_credential'],
  )
  await revokeAccountPasskey(db, enrollmentSession.context, 'identity_test_credential', base + 25)
  assert.equal(
    database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(accountIds.weakStaff).security_version,
    1,
  )
  assert.equal(
    database
      .prepare('SELECT status FROM identity_passkey_credential WHERE credential_id = ?')
      .get('identity_test_credential').status,
    'revoked',
  )
  assert.equal(
    (
      await getAuthContext({
        database: db,
        token: enrollmentSession.draft.token,
        now: base + 25,
      })
    ).kind,
    'anonymous',
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_security_event
         WHERE event_type IN ('account.signed_in', 'account.passkey.enrolled',
                              'account.passkey.revoked')`,
      )
      .get().count,
    3,
  )
  console.log('unified passkey service tests passed')
} finally {
  database.close()
}
