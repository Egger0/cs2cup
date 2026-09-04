import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
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

const { registerAccount } = await import('../lib/identity/account-registration.ts')
const { completePasskeyAccountSetup } = await import('../lib/identity/passkey-account-setup.ts')
const { migrateLegacyParticipantCredential } =
  await import('../lib/identity/legacy-participant-migration.ts')
const { authenticatePassword } = await import('../lib/identity/internal/password-authentication.ts')
const { revokeAccountPasskey } = await import('../lib/identity/internal/passkey-credentials.ts')
const { IdentityPasskeyError } = await import('../lib/identity/internal/passkey-shared.ts')
const { consumeRecoveryCode } =
  await import('../lib/identity/internal/recovery-code-consumption.ts')
const { RecoveryCodeError } = await import('../lib/identity/internal/recovery-code-shared.ts')
const { generateRecoveryCodes } = await import('../lib/identity/internal/recovery-codes.ts')
const { createSessionDraft, getAuthContext, sessionInsertStatement } =
  await import('../lib/identity/kernel.ts')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

function adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      return {
        bind(...values) {
          return {
            async first() {
              return statement.get(...values) ?? null
            },
            async all() {
              return { results: statement.all(...values) }
            },
            async run() {
              return statement.run(...values)
            },
          }
        },
      }
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

const opaque = () => randomBytes(32).toString('base64url')
const hash = () => randomBytes(32).toString('hex')
const database = await createMigratedDatabase()
const db = adapter(database)
const base = Date.now()
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[1, pepper]]) }
const password = 'amber glacier quiet harbor 2028'
const cleanRange = async () => new Response(`${'A'.repeat(35)}:1\r\n`, { status: 200 })

async function passkeyContext(accountId, credentialId) {
  const intentId = opaque()
  database
    .prepare(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
         flow_id, idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'passkey_sign_in', ?, ?, 'account_security', ?, ?, ?, ?)`,
    )
    .run(intentId, hash(), accountId, hash(), opaque(), hash(), base - 1, base + 60_000)
  database
    .prepare(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'passkey_credential',
           completion_result_ref = ?, revision = revision + 1, write_nonce = ? WHERE id = ?`,
    )
    .run(base, opaque(), credentialId, opaque(), intentId)
  const draft = await createSessionDraft({
    accountId,
    authentication: {
      method: 'passkey',
      authenticatorCredentialId: credentialId,
      authIntentId: intentId,
    },
    now: base,
  })
  assert.ok(await sessionInsertStatement(db, draft).first())
  const context = await getAuthContext({ database: db, token: draft.token, now: base })
  if (context.kind !== 'authenticated') throw new Error('Passkey session did not resolve')
  return context
}

try {
  await registerAccount(
    db,
    {
      username: 'occupied.user',
      displayName: '已有账号',
      password: 'cobalt meadow winter lantern 2027',
      passwordConfirmation: 'cobalt meadow winter lantern 2027',
    },
    peppers,
    { now: base - 100, fetcher: cleanRange },
  )

  const principalId = `p_${opaque()}`
  const credentialId = 'legacy-setup-credential'
  database
    .prepare(
      `INSERT INTO participant_principal (id, webauthn_user_handle, created_at)
       VALUES (?, ?, '2026-01-01 00:00:00')`,
    )
    .run(principalId, opaque())
  database
    .prepare('INSERT INTO participant_profile (principal_id, display_name) VALUES (?, ?)')
    .run(principalId, '迁移玩家')
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, counter, transports_json, device_type,
         backed_up, created_at)
       VALUES (?, ?, ?, 0, '["internal"]', 'multiDevice', 1, ?)`,
    )
    .run(
      credentialId,
      principalId,
      Buffer.from('legacy-public-key').toString('base64url'),
      base - 10,
    )
  const accountId = await migrateLegacyParticipantCredential(db, credentialId, base - 5)
  const context = await passkeyContext(accountId, credentialId)

  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO identity_self_registration
            (id, request_proof_hash, expected_account_id, requested_username,
             requested_display_name, created_at, expires_at)
           VALUES (?, ?, ?, 'unproven.user', '迁移玩家', ?, ?)`,
        )
        .run(opaque(), hash(), accountId, base, base + 600_000),
    /self registration must start fresh/,
  )
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO identity_passkey_account_setup
            (id, account_id, initiating_session_id, requested_username, created_at, expires_at)
           VALUES (?, ?, ?, 'stale.user', ?, ?)`,
        )
        .run(opaque(), accountId, context.session.id, base + 900_001, base + 1_500_001),
    /recent migrated passkey session/,
  )
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE identity_passkey_credential
           SET status = 'revoked', revoked_at = ?, revision = revision + 1, write_nonce = ?
           WHERE credential_id = ?`,
        )
        .run(base + 1, opaque(), credentialId),
    /last login credential/,
  )
  await assert.rejects(
    () => generateRecoveryCodes(db, context, peppers, base + 1),
    error => error instanceof RecoveryCodeError && error.code === 'account_setup_required',
  )
  await assert.rejects(
    () => revokeAccountPasskey(db, context, credentialId, base + 1),
    error => error instanceof IdentityPasskeyError && error.code === 'last_credential',
  )

  const fields = { username: 'legacy.player', password, passwordConfirmation: password }
  assert.deepEqual(
    await completePasskeyAccountSetup(
      db,
      context,
      { ...fields, username: 'occupied.user' },
      peppers,
      { now: base + 2, fetcher: cleanRange },
    ),
    { ok: false, reason: 'username_unavailable', field: 'username' },
  )
  assert.deepEqual(
    await completePasskeyAccountSetup(db, context, fields, peppers, {
      now: base + 3,
      fetcher: async () => new Response('', { status: 503 }),
    }),
    { ok: false, reason: 'screening_unavailable', field: 'password' },
  )
  const compromised = await completePasskeyAccountSetup(db, context, fields, peppers, {
    now: base + 4,
    fetcher: async url => {
      const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
      const encoded = Buffer.from(digest).toString('hex').toUpperCase()
      assert.equal(url.toString().slice(-5), encoded.slice(0, 5))
      return new Response(`${encoded.slice(5)}:9\r\n`, { status: 200 })
    },
  })
  assert.deepEqual(compromised, {
    ok: false,
    reason: 'password_compromised',
    field: 'password',
  })
  assert.deepEqual(
    await completePasskeyAccountSetup(db, context, fields, peppers, {
      now: base + 900_001,
      fetcher: cleanRange,
    }),
    { ok: false, reason: 'reauth_required' },
  )

  assert.deepEqual(
    await completePasskeyAccountSetup(db, context, fields, peppers, {
      now: base + 5,
      fetcher: cleanRange,
    }),
    { ok: true, username: fields.username },
  )
  assert.deepEqual(
    await completePasskeyAccountSetup(db, context, fields, peppers, {
      now: base + 6,
      fetcher: cleanRange,
    }),
    { ok: false, reason: 'already_configured' },
  )
  const setup = database
    .prepare(
      `SELECT setup.consumed_at, setup.revision, credential.username,
              credential.registration_kind
       FROM identity_passkey_account_setup AS setup
       JOIN identity_password_credential AS credential
         ON credential.id = setup.password_credential_id
       WHERE setup.account_id = ?`,
    )
    .get(accountId)
  assert.deepEqual(
    { ...setup },
    {
      consumed_at: base + 5,
      revision: 1,
      username: fields.username,
      registration_kind: 'self_registration',
    },
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_security_event
         WHERE target_account_id = ? AND event_type = 'account.password.created'`,
      )
      .get(accountId).count,
    1,
  )

  const codes = await generateRecoveryCodes(db, context, peppers, base + 7)
  assert.equal(codes.length, 10)
  const passwordLogin = await authenticatePassword(
    db,
    { username: fields.username, password },
    peppers,
    base + 8,
  )
  if (!passwordLogin.ok) throw new Error('Initial password did not authenticate')
  const passwordContext = await getAuthContext({
    database: db,
    token: passwordLogin.token,
    now: base + 8,
  })
  if (passwordContext.kind !== 'authenticated') throw new Error('Password session did not resolve')
  await revokeAccountPasskey(db, passwordContext, credentialId, base + 9)
  const recovery = await consumeRecoveryCode(
    db,
    { username: fields.username, code: codes[0] },
    peppers,
    base + 10,
  )
  assert.match(recovery.token, /^[A-Za-z0-9_-]{43}$/)
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('legacy Passkey account setup services passed')
} finally {
  database.close()
}
