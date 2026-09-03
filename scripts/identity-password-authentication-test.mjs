import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { authenticatePassword } = await import('../lib/identity/internal/password-authentication.ts')
const { createPasswordVerifier, passwordVerifierForStorage } =
  await import('../lib/identity/internal/password-kdf.ts')
const { createModeratedIdentityFixture, moderated } =
  await import('./moderated-identity-schema-fixture.mjs')

function d1Adapter(database) {
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

const fixture = await createModeratedIdentityFixture()
const { database, execute } = fixture
const db = d1Adapter(database)
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[pepper.version, pepper]]) }
const password = 'correct horse battery stable 2026'

try {
  fixture.insertSelfRegistration()
  fixture.createActiveAccount()
  const stored = passwordVerifierForStorage(await createPasswordVerifier(password, pepper))
  execute(
    `INSERT INTO identity_password_credential
      (id, account_id, username, algorithm, parameters_json, salt, password_hash,
       pepper_version, registration_kind, self_registration_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self_registration', ?, 170, 170)`,
    [
      moderated.credentialId,
      moderated.accountId,
      moderated.username,
      stored.algorithm,
      stored.parameters_json,
      Buffer.from(stored.salt),
      Buffer.from(stored.password_hash),
      stored.pepper_version,
      moderated.registrationId,
    ],
  )
  fixture.consumeSelfRegistration()

  const failed = await authenticatePassword(
    db,
    { username: 'PLAYER.ONE', password: 'a different incorrect password' },
    peppers,
    400,
  )
  assert.deepEqual(failed, { ok: false, reason: 'invalid' })
  assert.equal(
    database
      .prepare('SELECT failed_attempt_count FROM identity_password_credential WHERE id = ?')
      .get(moderated.credentialId).failed_attempt_count,
    1,
  )

  const signedIn = await authenticatePassword(
    db,
    { username: 'PLAYER.ONE', password },
    peppers,
    401,
  )
  assert.equal(signedIn.ok, true)
  assert.match(signedIn.ok && signedIn.token, /^[A-Za-z0-9_-]{43}$/)
  const session = database
    .prepare(
      `SELECT auth_method, password_credential_id, password_verification_nonce
       FROM identity_session WHERE id = ?`,
    )
    .get(signedIn.ok ? signedIn.sessionId : '')
  assert.equal(session.auth_method, 'password')
  assert.equal(session.password_credential_id, moderated.credentialId)
  assert.match(session.password_verification_nonce, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_security_event WHERE event_type = ?')
      .get('account.signed_in').count,
    1,
  )

  const unknown = await authenticatePassword(
    db,
    { username: 'unknown.person', password },
    peppers,
    402,
  )
  assert.deepEqual(unknown, { ok: false, reason: 'invalid' })

  console.log('unified password authentication command passed')
} finally {
  database.close()
}
