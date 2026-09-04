import assert from 'node:assert/strict'
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

const { registerAccount } = await import('../lib/identity/account-registration.ts')
const {
  AccountSessionError,
  listAccountSessions,
  revokeAccountSession,
  revokeOtherAccountSessions,
} = await import('../lib/identity/internal/account-sessions.ts')
const { changeAccountPassword } = await import('../lib/identity/internal/password-change.ts')
const { authenticatePassword } = await import('../lib/identity/internal/password-authentication.ts')
const { consumeRecoveryCode } =
  await import('../lib/identity/internal/recovery-code-consumption.ts')
const { RecoveryCodeError } = await import('../lib/identity/internal/recovery-code-shared.ts')
const { generateRecoveryCodes, recoveryCodeSummary } =
  await import('../lib/identity/internal/recovery-codes.ts')
const { clientSessionLabel } = await import('../lib/identity/internal/session-display.ts')
const { getAuthContext } = await import('../lib/identity/kernel.ts')
const { hashOpaqueToken } = await import('../lib/opaque-token.ts')
const { d1Adapter } = await import('./identity-kernel-test-fixture.mjs')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

const database = await createMigratedDatabase()
const db = d1Adapter(database)
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[1, pepper]]) }
const cleanRange = async () => new Response(`${'A'.repeat(35)}:1\r\n`, { status: 200 })
const base = Date.now()
const passwords = {
  original: 'violet river lantern meadow 2026',
  changed: 'granite orbit silver kettle 2027',
  recovered: 'harbor comet velvet compass 2028',
}

assert.equal(
  clientSessionLabel(
    new Headers({
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    }),
  ),
  'Safari · macOS',
)

async function contextFor(token, now) {
  const context = await getAuthContext({ database: db, token, now })
  assert.equal(context.kind, 'authenticated')
  return context
}

try {
  const created = await registerAccount(
    db,
    {
      username: 'safe.user',
      displayName: '安全用户',
      password: passwords.original,
      passwordConfirmation: passwords.original,
    },
    peppers,
    { now: base, fetcher: cleanRange, clientLabel: 'Safari · macOS' },
  )
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('account setup failed')
  const initial = await contextFor(created.token, base)

  const changed = await changeAccountPassword(
    db,
    initial,
    {
      currentPassword: passwords.original,
      password: passwords.changed,
      passwordConfirmation: passwords.changed,
    },
    peppers,
    { now: base + 10, fetcher: cleanRange },
  )
  assert.equal(changed.ok, true)
  if (!changed.ok) throw new Error(`password change failed: ${changed.reason}`)
  assert.equal(
    (await getAuthContext({ database: db, token: created.token, now: base + 13 })).kind,
    'anonymous',
  )
  const current = await contextFor(changed.token, base + 13)

  const second = await authenticatePassword(
    db,
    { username: 'safe.user', password: passwords.changed },
    peppers,
    base + 20,
    {},
    'Chrome · Windows',
  )
  const third = await authenticatePassword(
    db,
    { username: 'safe.user', password: passwords.changed },
    peppers,
    base + 21,
    {},
    'Firefox · Linux',
  )
  assert.equal(second.ok && third.ok, true)
  if (!second.ok || !third.ok) throw new Error('session setup failed')
  const sessions = await listAccountSessions(db, current, base + 22)
  assert.equal(sessions.length, 3)
  assert.equal(sessions[0].clientLabel, 'Safari · macOS')
  assert.deepEqual(
    new Set(sessions.slice(1).map(session => session.clientLabel)),
    new Set(['Chrome · Windows', 'Firefox · Linux']),
  )
  await revokeAccountSession(db, current, second.sessionId, base + 23)
  assert.equal((await listAccountSessions(db, current, base + 24)).length, 2)
  assert.equal(await revokeOtherAccountSessions(db, current, base + 25), 1)
  assert.equal((await listAccountSessions(db, current, base + 26)).length, 1)
  assert.deepEqual(
    JSON.parse(
      database
        .prepare(
          `SELECT details_json FROM identity_security_event
           WHERE event_type = 'identity.sessions.revoked' ORDER BY created_at DESC LIMIT 1`,
        )
        .get().details_json,
    ),
    { count: 1 },
  )
  assert.equal(await revokeOtherAccountSessions(db, current, base + 27), 0)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_security_event
         WHERE event_type = 'identity.sessions.revoked'`,
      )
      .get().count,
    1,
  )
  await assert.rejects(
    () => revokeOtherAccountSessions(db, current, base + 16 * 60 * 1000),
    error => error instanceof AccountSessionError && error.code === 'reauth_required',
  )
  await assert.rejects(
    () => generateRecoveryCodes(db, current, peppers, base + 16 * 60 * 1000),
    error => error instanceof RecoveryCodeError && error.code === 'reauth_required',
  )

  const firstCodes = await generateRecoveryCodes(db, current, peppers, base + 30)
  assert.equal(firstCodes.length, 10)
  assert.match(firstCodes[0], /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/)
  assert.deepEqual(await recoveryCodeSummary(db, current, base + 31), {
    enabled: true,
    remaining: 10,
    createdAt: base + 30,
  })
  const replacementCodes = await generateRecoveryCodes(db, current, peppers, base + 32)
  await assert.rejects(
    () =>
      consumeRecoveryCode(db, { username: 'safe.user', code: firstCodes[0] }, peppers, base + 33),
    error => error instanceof RecoveryCodeError && error.code === 'invalid_code',
  )

  const legacyAdminHash = 'a'.repeat(64)
  const legacyParticipantHash = 'b'.repeat(64)
  const legacyPrincipal = `p_${'R'.repeat(43)}`
  const legacyCredential = 'recovery-cutover-passkey'
  database.exec(`
    INSERT OR IGNORE INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'legacy-recovery-owner', 'salt', 'hash');
  `)
  database
    .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, ?)')
    .run(legacyAdminHash, base + 60_000)
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(legacyPrincipal, 'U'.repeat(43))
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, device_type, created_at)
       VALUES (?, ?, ?, 'multiDevice', ?)`,
    )
    .run(legacyCredential, legacyPrincipal, 'public-key', base)
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(legacyParticipantHash, legacyPrincipal, legacyCredential, base, base + 60_000)

  const recovery = await consumeRecoveryCode(
    db,
    {
      username: 'SAFE.USER',
      code: replacementCodes[0].toLowerCase(),
      clientLabel: 'Firefox · Linux',
    },
    peppers,
    base + 34,
    {
      unifiedTokenHash: await hashOpaqueToken(changed.token),
      legacyAdminTokenHash: legacyAdminHash,
      legacyParticipantTokenHash: legacyParticipantHash,
    },
  )
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM admin_session').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count, 0)
  assert.equal(
    (await getAuthContext({ database: db, token: changed.token, now: base + 34 })).kind,
    'anonymous',
  )
  const recoveryContext = await contextFor(recovery.token, base + 34)
  assert.equal(recoveryContext.session.recoveryRestricted, true)
  await assert.rejects(
    () => listAccountSessions(db, recoveryContext, base + 34),
    error => error instanceof AccountSessionError && error.code === 'recovery_restricted',
  )
  await assert.rejects(
    () => recoveryCodeSummary(db, recoveryContext, base + 34),
    error => error instanceof RecoveryCodeError && error.code === 'recovery_restricted',
  )
  await assert.rejects(
    () =>
      consumeRecoveryCode(
        db,
        { username: 'safe.user', code: replacementCodes[0] },
        peppers,
        base + 35,
      ),
    error => error instanceof RecoveryCodeError && error.code === 'invalid_code',
  )

  const recovered = await changeAccountPassword(
    db,
    recoveryContext,
    { password: passwords.recovered, passwordConfirmation: passwords.recovered },
    peppers,
    { now: base + 36, fetcher: cleanRange },
  )
  assert.equal(recovered.ok, true)
  if (!recovered.ok) throw new Error(`recovery password change failed: ${recovered.reason}`)
  const recoveredContext = await contextFor(recovered.token, base + 39)
  assert.equal(recoveredContext.session.recoveryRestricted, false)
  assert.equal(
    (await listAccountSessions(db, recoveredContext, base + 39))[0].clientLabel,
    'Firefox · Linux',
  )
  assert.equal((await recoveryCodeSummary(db, recoveredContext, base + 40)).enabled, false)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_session WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .get(recoveredContext.account.id).count,
    1,
  )
  assert.equal(
    (
      await authenticatePassword(
        db,
        { username: 'safe.user', password: passwords.changed },
        peppers,
        base + 41,
      )
    ).ok,
    false,
  )
  assert.equal(
    (
      await authenticatePassword(
        db,
        { username: 'safe.user', password: passwords.recovered },
        peppers,
        base + 42,
      )
    ).ok,
    true,
  )
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0)
  console.log('identity account security services passed')
} finally {
  database.close()
}
