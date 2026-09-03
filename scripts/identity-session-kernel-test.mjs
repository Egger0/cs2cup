import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(`
  export async function cookies() { throw new Error('Unexpected cookie transport in kernel test') }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() { throw new Error('Unexpected production binding in kernel test') }
`)
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

const {
  clearIdentitySessionCookie,
  createSessionDraft,
  getAuthContext,
  IDENTITY_SESSION_COOKIE_NAME,
  RECOVERY_SESSION_ABSOLUTE_MS,
  RECOVERY_SESSION_IDLE_MS,
  revokeSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sessionInsertStatement,
  setIdentitySessionCookie,
} = await import('../lib/identity/kernel.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

try {
  const draft = await createSessionDraft({
    accountId: accountIds.owner,
    authentication: {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.owner,
      authIntentId: fixture.createPasskeyProof(accountIds.owner, credentialIds.owner),
    },
    displayMetadata: { browser: 'Test', trusted: false },
    now,
  })
  assert.match(draft.token, /^[A-Za-z0-9_-]{43}$/)
  assert.match(draft.record.tokenHash, /^[0-9a-f]{64}$/)
  assert.notEqual(draft.token, draft.record.tokenHash)
  assert.equal(draft.record.idleExpiresAt, now + SESSION_IDLE_MS)
  assert.equal(draft.record.absoluteExpiresAt, now + SESSION_ABSOLUTE_MS)
  assert.equal(draft.record.phishingResistantAt, now)
  assert.equal(Object.isFrozen(draft.record), true)
  assert.throws(
    () => sessionInsertStatement(db, { ...draft, record: { ...draft.record } }),
    /not issued by kernel/,
  )
  assert.equal((await sessionInsertStatement(db, draft).first()).id, draft.record.id)
  assert.equal(
    database
      .prepare('PRAGMA table_info(identity_session)')
      .all()
      .some(row => row.name === 'token'),
    false,
  )
  assert.equal(
    database.prepare('SELECT token_hash FROM identity_session WHERE id = ?').get(draft.record.id)
      .token_hash,
    draft.record.tokenHash,
  )

  const context = await getAuthContext({ database: db, token: draft.token, now })
  assert.equal(context.kind, 'authenticated')
  assert.deepEqual(context.account, {
    id: accountIds.owner,
    displayName: 'Person 1',
    verificationState: 'verified',
  })
  assert.equal(context.session.authMethod, 'passkey')
  const serializedContext = JSON.stringify(context)
  assert.doesNotMatch(serializedContext, /token|role|capabilit/i)
  assert.equal((await getAuthContext({ database: db, token: opaque('z'), now })).kind, 'anonymous')
  assert.equal((await getAuthContext({ database: db, token: 'malformed', now })).kind, 'anonymous')
  const unprovenBootstrapToken = opaque('b')
  fixture.execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'bootstrap', ?, ?, ?, ?, ?)`,
    [
      opaque('x'),
      createHash('sha256').update(unprovenBootstrapToken).digest('hex'),
      accountIds.owner,
      now,
      now,
      now + SESSION_IDLE_MS,
      now + SESSION_ABSOLUTE_MS,
      now,
    ],
  )
  assert.equal(
    (await getAuthContext({ database: db, token: unprovenBootstrapToken, now })).kind,
    'anonymous',
    'a raw bootstrap row has no authentication provenance and must fail closed',
  )

  const sliding = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const touchedAt = now + SESSION_TOUCH_INTERVAL_MS
  const touched = await getAuthContext({ database: db, token: sliding.draft.token, now: touchedAt })
  assert.equal(touched.kind, 'authenticated')
  assert.equal(touched.session.lastSeenAt, touchedAt)
  assert.equal(touched.session.idleExpiresAt, touchedAt + SESSION_IDLE_MS)
  assert.deepEqual(
    {
      ...database
        .prepare(
          'SELECT last_seen_at, idle_expires_at, revision FROM identity_session WHERE id = ?',
        )
        .get(sliding.draft.record.id),
    },
    { last_seen_at: touchedAt, idle_expires_at: touchedAt + SESSION_IDLE_MS, revision: 1 },
  )

  const cookieWrites = []
  const response = { cookies: { set: (...arguments_) => cookieWrites.push(arguments_) } }
  setIdentitySessionCookie(response, draft.token, draft.record.absoluteExpiresAt, now)
  clearIdentitySessionCookie(response)
  assert.deepEqual(cookieWrites[0], [
    IDENTITY_SESSION_COOKIE_NAME,
    draft.token,
    {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      maxAge: SESSION_ABSOLUTE_MS / 1000,
    },
  ])
  assert.deepEqual(cookieWrites[1], [
    IDENTITY_SESSION_COOKIE_NAME,
    '',
    { httpOnly: true, path: '/', sameSite: 'lax', secure: true, maxAge: 0 },
  ])

  assert.equal(await revokeSession(context, '', { database: db, now: now + 1 }), false)
  assert.equal(await revokeSession(context, 'user_sign_out', { database: db, now: now + 1 }), true)
  assert.equal(await revokeSession(context, 'again', { database: db, now: now + 2 }), false)
  assert.equal(
    (await getAuthContext({ database: db, token: draft.token, now: now + 2 })).kind,
    'anonymous',
  )
  const revoked = database
    .prepare('SELECT revoked_at, revoke_reason, token_hash FROM identity_session WHERE id = ?')
    .get(draft.record.id)
  assert.deepEqual(
    { revokedAt: revoked.revoked_at, reason: revoked.revoke_reason, hash: revoked.token_hash },
    { revokedAt: now + 1, reason: 'user_sign_out', hash: draft.record.tokenHash },
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT event_type, actor_account_id, actor_session_id, resource_type, resource_id
           FROM identity_security_event WHERE actor_session_id = ?`,
        )
        .get(draft.record.id),
    },
    {
      event_type: 'identity.session.revoked',
      actor_account_id: accountIds.owner,
      actor_session_id: draft.record.id,
      resource_type: 'account',
      resource_id: accountIds.owner,
    },
  )

  const expiredDraft = await createSessionDraft({
    accountId: accountIds.manager,
    authentication: {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.manager,
      authIntentId: fixture.createPasskeyProof(
        accountIds.manager,
        credentialIds.manager,
        now - SESSION_IDLE_MS,
      ),
    },
    now: now - SESSION_IDLE_MS,
  })
  await sessionInsertStatement(db, expiredDraft).first()
  assert.equal(
    (await getAuthContext({ database: db, token: expiredDraft.token, now })).kind,
    'anonymous',
  )

  const active = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  assert.equal(
    active.context.account.verificationState,
    'legacy_unverified',
    'account verification metadata is not an enrollment-approval or sign-in gate',
  )
  fixture.execute(
    `UPDATE identity_account
     SET security_version = security_version + 1, revision = revision + 1,
         write_nonce = ?, updated_at = ? WHERE id = ?`,
    [opaque('j'), now + 1, accountIds.manager],
  )
  assert.equal(
    (await getAuthContext({ database: db, token: active.draft.token, now: now + 1 })).kind,
    'anonymous',
  )

  const recovery = await createSessionDraft({
    accountId: accountIds.recovery,
    authentication: { method: 'oidc', recovery: { authIntentId: opaque('i') } },
    now,
  })
  assert.equal(recovery.record.recoveryRestricted, true)
  assert.equal(recovery.record.idleExpiresAt, now + RECOVERY_SESSION_IDLE_MS)
  assert.equal(recovery.record.absoluteExpiresAt, now + RECOVERY_SESSION_ABSOLUTE_MS)
  assert.equal(recovery.record.phishingResistantAt, null)
  const password = await createSessionDraft({
    accountId: accountIds.owner,
    authentication: {
      method: 'password',
      passwordCredentialId: opaque('d'),
      verificationNonce: opaque('v'),
    },
    now,
  })
  assert.equal(password.record.passwordCredentialId, opaque('d'))
  assert.equal(password.record.passwordVerificationNonce, opaque('v'))
  assert.equal(password.record.phishingResistantAt, null)
  await assert.rejects(
    () =>
      createSessionDraft({
        accountId: accountIds.owner,
        authentication: {
          method: 'password',
          passwordCredentialId: opaque('d'),
          verificationNonce: 'bad!',
        },
        now,
      }),
    /Invalid password authentication provenance/,
  )
  const longCredential = await createSessionDraft({
    accountId: accountIds.owner,
    authentication: {
      method: 'passkey',
      authenticatorCredentialId: 'a'.repeat(512),
      authIntentId: opaque('e'),
    },
    now,
  })
  assert.equal(longCredential.record.authenticatorCredentialId.length, 512)
  const assisted = await createSessionDraft({
    accountId: accountIds.owner,
    authentication: { method: 'assisted_recovery', recovery: { authIntentId: opaque('h') } },
    now,
  })
  assert.equal(assisted.record.recoveryRestricted, true)
  await assert.rejects(
    () =>
      createSessionDraft({
        accountId: accountIds.owner,
        authentication: { method: 'cas' },
        now,
      }),
    /database-bound recovery provenance/,
  )
  await assert.rejects(
    () =>
      createSessionDraft({
        accountId: accountIds.owner,
        authentication: { method: 'bootstrap' },
        now,
      }),
    /Invalid unified session input/,
  )
  await assert.rejects(
    () =>
      createSessionDraft({
        accountId: accountIds.owner,
        authentication: {
          method: 'passkey',
          authenticatorCredentialId: 'bad!',
          authIntentId: opaque('g'),
        },
        now,
      }),
    /Invalid Passkey authentication provenance/,
  )
  assert.throws(() => setIdentitySessionCookie(response, draft.token, now, now), /expired/)
  console.log('unified identity session kernel tests passed')
} finally {
  database.close()
}
