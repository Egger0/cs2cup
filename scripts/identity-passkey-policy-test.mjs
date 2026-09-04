import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('no cookies') }`,
)
const bindingsModule = dataModule(
  `export function cloudflareBindings() { throw new Error('no production binding') }`,
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

const { accountIds, createIdentityKernelFixture, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')
const { claimPasskeyIntentAttempt, issuePasskeyIntent } =
  await import('../lib/identity/internal/passkey-intent.ts')
const { preparePasskeyEnrollment } = await import('../lib/identity/internal/passkey-enrollment.ts')
const { clearLegacyPasskeyCookies, replacementFromPasskeyRequest } =
  await import('../lib/identity/internal/passkey-legacy-session.ts')
const { IdentityPasskeyError } = await import('../lib/identity/internal/passkey-shared.ts')
const { hashOpaqueToken } = await import('../lib/opaque-token.ts')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture

async function expectCeremonyFailure(operation) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof IdentityPasskeyError)
    assert.equal(error.code, 'invalid_ceremony')
    return true
  })
}

try {
  const bounded = await issuePasskeyIntent(db, {
    purpose: 'passkey_sign_in',
    redirectKey: 'account',
    context: {},
    now: now + 100,
  })
  for (let index = 1; index <= 5; index += 1) {
    const attempt = await claimPasskeyIntentAttempt(db, {
      purpose: 'passkey_sign_in',
      secret: bounded.secret,
      now: now + 100 + index,
    })
    assert.equal(attempt.attemptCount, index)
  }
  await expectCeremonyFailure(() =>
    claimPasskeyIntentAttempt(db, {
      purpose: 'passkey_sign_in',
      secret: bounded.secret,
      now: now + 106,
    }),
  )

  const expiring = await issuePasskeyIntent(db, {
    purpose: 'passkey_sign_in',
    redirectKey: 'account',
    context: {},
    now: now + 200,
  })
  await expectCeremonyFailure(() =>
    claimPasskeyIntentAttempt(db, {
      purpose: 'passkey_sign_in',
      secret: expiring.secret,
      now: expiring.expiresAt,
    }),
  )

  const oldSession = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now - 15 * 60 * 1000 - 1,
  )
  await assert.rejects(
    () =>
      issuePasskeyIntent(db, {
        purpose: 'passkey_enrollment',
        authenticatedContext: oldSession.context,
        redirectKey: 'account_security',
        context: {},
        now,
      }),
    error => error instanceof IdentityPasskeyError && error.code === 'reauth_required',
  )
  const staleEnrollmentIntent = 'r'.repeat(43)
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
       flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_enrollment', ?, ?, 'account_security', ?, ?, ?, ?)`,
    [
      staleEnrollmentIntent,
      '4'.repeat(64),
      accountIds.weakStaff,
      '5'.repeat(64),
      's'.repeat(43),
      '6'.repeat(64),
      now,
      now + 100,
    ],
  )
  assert.throws(
    () =>
      execute(
        `INSERT INTO identity_passkey_enrollment_authorization
          (auth_intent_id, account_id, initiating_session_id, authorized_at)
         VALUES (?, ?, ?, ?)`,
        [staleEnrollmentIntent, accountIds.weakStaff, oldSession.context.session.id, now],
      ),
    /recent authentication/,
  )

  const session = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now + 300,
  )
  const enrollment = await preparePasskeyEnrollment(db, {
    context: session.context,
    now: now + 301,
  })
  execute(
    `UPDATE identity_session SET revoked_at = ?, revoke_reason = 'test revocation',
            revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [now + 302, 'R'.repeat(43), session.context.session.id],
  )
  await expectCeremonyFailure(() =>
    claimPasskeyIntentAttempt(db, {
      purpose: 'passkey_enrollment',
      authenticatedContext: session.context,
      secret: enrollment.intent.secret,
      now: now + 303,
    }),
  )

  const unauthorizedIntent = 'U'.repeat(43)
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
       flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_enrollment', ?, ?, 'account_security', ?, ?, ?, ?)`,
    [
      unauthorizedIntent,
      '1'.repeat(64),
      accountIds.owner,
      '2'.repeat(64),
      'V'.repeat(43),
      '3'.repeat(64),
      now + 400,
      now + 500,
    ],
  )
  assert.throws(
    () =>
      execute(
        `INSERT INTO identity_passkey_credential
          (credential_id, account_id, registration_kind, registration_auth_intent_id,
           public_key, device_type, created_at)
         VALUES ('unauthorized_credential', ?, 'ceremony', ?, ?, 'singleDevice', ?)`,
        [accountIds.owner, unauthorizedIntent, Buffer.from('key'), now + 401],
      ),
    /signed-in authorization/,
  )

  const intentColumns = new Set(
    database
      .prepare('PRAGMA table_info(identity_auth_intent)')
      .all()
      .map(row => row.name),
  )
  assert.equal(intentColumns.has('secret'), false)
  assert.equal(intentColumns.has('passkey_challenge'), false)

  const routePaths = [
    '../app/api/auth/passkeys/authenticate/options/route.ts',
    '../app/api/auth/passkeys/authenticate/verify/route.ts',
    '../app/api/auth/passkeys/enroll/options/route.ts',
    '../app/api/auth/passkeys/enroll/verify/route.ts',
    '../app/api/auth/passkeys/route.ts',
  ]
  const routeSources = await Promise.all(
    routePaths.map(path => readFile(new URL(path, import.meta.url), 'utf8')),
  )
  for (const source of routeSources) {
    assert.match(source, /privateJson|passkeyError/)
    assert.doesNotMatch(source, /INSERT INTO participant_session/)
  }
  for (const source of routeSources.slice(0, 4)) assert.match(source, /assertCsrfRequest/)
  for (const source of [routeSources[1], routeSources[2], routeSources[3], routeSources[4]]) {
    assert.match(source, /readPasskeyJson/)
  }
  assert.match(routeSources[1], /setIdentitySessionCookie/)
  assert.match(routeSources[1], /clearPasskeyLegacyCookies/)
  assert.match(routeSources[4], /clearIdentitySessionCookie/)

  const cookieSource = await readFile(
    new URL('../lib/passkey-ceremony.ts', import.meta.url),
    'utf8',
  )
  assert.match(cookieSource, /__Host-cs2cup_passkey_ceremony/)
  assert.match(cookieSource, /httpOnly: true/)
  assert.match(cookieSource, /secure: true/)
  assert.match(cookieSource, /sameSite: 'lax'/)
  assert.match(cookieSource, /5 \* 60/)

  const cookieValues = new Map([
    ['__Host-cs2cup_session', 'S'.repeat(43)],
    ['cs2cup_admin', 'legacy-admin-token'],
    ['__Host-cs2cup_participant', 'P'.repeat(43)],
  ])
  const replacement = await replacementFromPasskeyRequest({
    cookies: {
      get: name => (cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined),
    },
  })
  assert.equal(replacement.unifiedTokenHash, await hashOpaqueToken('S'.repeat(43)))
  assert.equal(replacement.legacyAdminTokenHash, await hashOpaqueToken('legacy-admin-token'))
  assert.equal(replacement.legacyParticipantTokenHash, await hashOpaqueToken('P'.repeat(43)))
  const cleared = []
  clearLegacyPasskeyCookies({ cookies: { set: (...values) => cleared.push(values) } })
  assert.deepEqual(
    cleared.map(([name, , options]) => [name, options.maxAge, options.httpOnly, options.secure]),
    [
      ['cs2cup_admin', 0, true, true],
      ['__Host-cs2cup_participant', 0, true, true],
    ],
  )
  console.log('unified passkey policy and route wiring tests passed')
} finally {
  database.close()
}
