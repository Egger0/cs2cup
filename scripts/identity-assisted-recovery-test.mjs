import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(`export async function cookies() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    if (specifier === '../cloudflare-bindings.ts') {
      return {
        url: dataModule(`export function cloudflareBindings() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { ASSISTED_RECOVERY_TTL_MS, consumeAssistedRecovery, issueAssistedRecovery } =
  await import('../lib/identity/assisted-recovery.ts')
const { registerAccount } = await import('../lib/identity/account-registration.ts')
const { authenticatePassword } = await import('../lib/identity/internal/password-authentication.ts')
const { changeAccountPassword } = await import('../lib/identity/internal/password-change.ts')
const { getAuthContext } = await import('../lib/identity/kernel.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[1, pepper]]) }
const cleanRange = async () => new Response(`${'A'.repeat(35)}:1\r\n`, { status: 200 })
const evidence = 'Verified ownership over QQ with the registered contact'
const count = (sql, ...values) => database.prepare(sql).get(...values).count

try {
  const created = await registerAccount(
    db,
    {
      username: 'locked.out',
      displayName: 'Locked Out',
      password: 'forgotten meadow lantern 2026',
      passwordConfirmation: 'forgotten meadow lantern 2026',
    },
    peppers,
    { now, fetcher: cleanRange },
  )
  if (!created.ok) throw new Error('account setup failed')
  const targetAccountId = (await getAuthContext({ database: db, token: created.token, now }))
    .account.id
  for (let attempt = 1; attempt <= 11; attempt += 1) {
    await authenticatePassword(
      db,
      { username: 'locked.out', password: 'wrong' },
      peppers,
      now + attempt,
    )
  }
  assert.ok(
    database
      .prepare('SELECT locked_until FROM identity_password_credential WHERE account_id = ?')
      .get(targetAccountId).locked_until >
      now + 60,
  )

  const owner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const issue = (context, input, at = now + 10) =>
    issueAssistedRecovery(db, context, { username: 'locked.out', evidence, ...input }, { now: at })

  assert.deepEqual(await issue(owner.context, { evidence: 'too short' }), {
    ok: false,
    reason: 'invalid_input',
  })
  assert.deepEqual(await issue(owner.context, { username: 'nobody.here' }), {
    ok: false,
    reason: 'not_found',
  })
  assert.deepEqual(await issue(owner.context, {}, now + 16 * 60 * 1000), {
    ok: false,
    reason: 'reauthentication_required',
  })
  const reviewer = await fixture.session(
    accountIds.reviewer,
    { method: 'password', passwordCredentialId: passwordCredentialIds.reviewer },
    now + 5,
  )
  assert.deepEqual(await issue(reviewer.context, {}), { ok: false, reason: 'forbidden' })
  const staff = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  assert.deepEqual(await issue(staff.context, {}), { ok: false, reason: 'forbidden' })
  assert.equal(count('SELECT COUNT(*) AS count FROM identity_assisted_recovery_case'), 0)

  const stale = await issue(owner.context, {})
  const issued = await issue(owner.context, {}, now + 11)
  assert.equal(stale.ok && issued.ok, true)
  if (!stale.ok || !issued.ok) throw new Error('issue failed')
  assert.equal(issued.expiresAt, now + 11 + ASSISTED_RECOVERY_TTL_MS)
  assert.equal(
    count(
      `SELECT COUNT(*) AS count FROM identity_assisted_recovery_authorization
       WHERE secret_hash LIKE ? OR receipt_hash LIKE ?`,
      `%${issued.secret}%`,
      `%${issued.secret}%`,
    ),
    0,
  )
  assert.equal(
    count(
      `SELECT COUNT(*) AS count FROM identity_security_event
       WHERE event_type = 'account.assisted_recovery.issued' AND actor_account_id = ?
         AND target_account_id = ?`,
      accountIds.platformOwner,
      targetAccountId,
    ),
    2,
  )

  assert.deepEqual(await consumeAssistedRecovery(db, { secret: 'x'.repeat(43) }, now + 20), {
    ok: false,
    reason: 'invalid_link',
  })
  assert.deepEqual(await consumeAssistedRecovery(db, { secret: issued.secret }, issued.expiresAt), {
    ok: false,
    reason: 'invalid_link',
  })
  const consumed = await consumeAssistedRecovery(
    db,
    { secret: issued.secret, clientLabel: 'Safari · iOS' },
    now + 20,
  )
  if (!consumed.ok) throw new Error(`consume failed: ${consumed.reason}`)
  assert.deepEqual(await consumeAssistedRecovery(db, { secret: issued.secret }, now + 21), {
    ok: false,
    reason: 'invalid_link',
  })

  const recovery = await getAuthContext({ database: db, token: consumed.token, now: now + 22 })
  assert.equal(recovery.kind, 'authenticated')
  assert.equal(recovery.account.id, targetAccountId)
  assert.equal(recovery.session.authMethod, 'assisted_recovery')
  assert.equal(recovery.session.recoveryRestricted, true)

  const changed = await changeAccountPassword(
    db,
    recovery,
    { password: '91919191', passwordConfirmation: '91919191' },
    peppers,
    { now: now + 30 },
  )
  if (!changed.ok) throw new Error(`recovered password change failed: ${changed.reason}`)
  const after = await getAuthContext({ database: db, token: changed.token, now: now + 40 })
  assert.equal(after.kind, 'authenticated')
  assert.equal(after.session.recoveryRestricted, false)
  assert.equal(
    (await getAuthContext({ database: db, token: created.token, now: now + 40 })).kind,
    'anonymous',
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT change_kind, confirmation_auth_intent_id, failed_attempt_count, locked_until
         FROM identity_password_change AS change
         JOIN identity_password_credential AS credential ON credential.last_change_id = change.id
         WHERE change.account_id = ?`,
        )
        .get(targetAccountId),
    },
    {
      change_kind: 'assisted_recovery',
      confirmation_auth_intent_id: null,
      failed_attempt_count: 0,
      locked_until: null,
    },
  )
  const signIn = await authenticatePassword(
    db,
    { username: 'locked.out', password: '91919191' },
    peppers,
    now + 50,
  )
  assert.equal(signIn.ok, true)

  assert.deepEqual(await consumeAssistedRecovery(db, { secret: stale.secret }, now + 60), {
    ok: false,
    reason: 'invalid_link',
  })

  console.log('identity assisted recovery tests passed')
} finally {
  database.close()
}
