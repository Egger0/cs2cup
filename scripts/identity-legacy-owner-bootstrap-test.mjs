import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(
          `export async function cookies() { throw new Error('Unexpected cookies') }`,
        ),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { bootstrapLegacyPlatformOwner } = await import('../lib/identity/legacy-owner-bootstrap.ts')
const { authorize, getAuthContext } = await import('../lib/identity/kernel.ts')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

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

const hash = value => createHash('sha256').update(value).digest('hex')
const count = (database, table) =>
  database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
const now = Date.now()
const currentLegacyHash = hash('current legacy owner session')
const otherLegacyHash = hash('other legacy owner session')
const participantHash = hash('opposing participant session')
const principalId = `p_${'Q'.repeat(43)}`
const participantCredentialId = 'bootstrap-opposing-credential'
const fields = {
  username: 'founder.one',
  displayName: 'Legacy Operator',
  password: 'A violet orchard crosses seven quiet rivers!',
  passwordConfirmation: 'A violet orchard crosses seven quiet rivers!',
}
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[pepper.version, pepper]]) }
const cleanRange = async () => new Response(`${'A'.repeat(35)}:1\r\n`, { status: 200 })

const database = await createMigratedDatabase()
const db = d1Adapter(database)

try {
  database
    .prepare(
      `INSERT INTO admin_account (id, username, password_salt, password_hash)
       VALUES (1, 'legacy-owner', 'legacy-salt', 'legacy-hash')`,
    )
    .run()
  const legacySession = database.prepare(
    'INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, ?)',
  )
  legacySession.run(currentLegacyHash, now + 2 * 60 * 60 * 1000)
  legacySession.run(otherLegacyHash, now + 2 * 60 * 60 * 1000)

  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(principalId, 'H'.repeat(43))
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, device_type, created_at)
       VALUES (?, ?, ?, 'multiDevice', ?)`,
    )
    .run(participantCredentialId, principalId, Buffer.from('public-key'), now - 1_000)
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(participantHash, principalId, participantCredentialId, now - 1_000, now + 60_000)

  const blocked = await bootstrapLegacyPlatformOwner(db, currentLegacyHash, fields, peppers, {
    now,
    legacyParticipantTokenHash: participantHash,
    fetcher: async () => {
      throw new Error('Password screening must not run for conflicting sessions')
    },
  })
  assert.deepEqual(blocked, { ok: false, reason: 'conflict' })
  assert.equal(count(database, 'identity_legacy_admin_bootstrap'), 0)
  database.prepare('DELETE FROM participant_session WHERE token_hash = ?').run(participantHash)

  const raced = await bootstrapLegacyPlatformOwner(db, currentLegacyHash, fields, peppers, {
    now,
    legacyParticipantTokenHash: participantHash,
    fetcher: async () => {
      database
        .prepare(
          `INSERT INTO participant_session
            (token_hash, principal_id, credential_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(participantHash, principalId, participantCredentialId, now, now + 60_000)
      return cleanRange()
    },
  })
  assert.deepEqual(raced, { ok: false, reason: 'conflict' })
  assert.equal(count(database, 'identity_legacy_admin_bootstrap'), 0)
  assert.equal(count(database, 'identity_account'), 0)
  assert.equal(count(database, 'admin_session'), 2)
  database.prepare('DELETE FROM participant_session WHERE token_hash = ?').run(participantHash)

  const result = await bootstrapLegacyPlatformOwner(db, currentLegacyHash, fields, peppers, {
    now,
    legacyParticipantTokenHash: participantHash,
    fetcher: cleanRange,
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(`Bootstrap failed: ${result.reason}`)
  assert.equal(count(database, 'admin_session'), 0)

  const evidence = database
    .prepare(
      `SELECT bootstrap.status, bootstrap.expected_account_id, account.status AS account_status,
              password.username, session.auth_method, assignment.role
       FROM identity_legacy_admin_bootstrap AS bootstrap
       JOIN identity_account AS account ON account.id = bootstrap.expected_account_id
       JOIN identity_password_credential AS password
         ON password.id = bootstrap.password_credential_id
       JOIN identity_session AS session ON session.account_id = account.id
       JOIN identity_role_assignment AS assignment
         ON assignment.id = bootstrap.owner_role_assignment_id`,
    )
    .get()
  assert.deepEqual(
    { ...evidence },
    {
      status: 'completed',
      expected_account_id: result.accountId,
      account_status: 'active',
      username: fields.username,
      auth_method: 'password',
      role: 'platform_owner',
    },
  )
  const audit = database
    .prepare(
      `SELECT event.actor_account_id, event.actor_session_id, event.target_account_id
       FROM identity_security_event AS event
       JOIN identity_session AS session ON session.id = event.actor_session_id
       WHERE event.event_type = 'account.legacy_owner_bootstrapped'`,
    )
    .get()
  assert.deepEqual(
    { ...audit },
    {
      actor_account_id: result.accountId,
      actor_session_id: audit.actor_session_id,
      target_account_id: result.accountId,
    },
  )
  assert.match(audit.actor_session_id, /^[A-Za-z0-9_-]{43}$/)

  const context = await getAuthContext({ database: db, token: result.token, now: now + 1 })
  assert.equal(context.kind, 'authenticated')
  assert.equal(context.kind === 'authenticated' && context.account.id, result.accountId)
  assert.equal(context.kind === 'authenticated' && context.session.id, audit.actor_session_id)
  assert.equal(
    (
      await authorize(
        context,
        'platform.configure',
        { kind: 'platform' },
        {
          database: db,
          now: now + 1,
        },
      )
    ).ok,
    true,
  )
  assert.equal(
    (
      await authorize(
        context,
        'platform.identity.review',
        { kind: 'platform' },
        {
          database: db,
          now: now + 1,
        },
      )
    ).ok,
    true,
  )

  const beforeReplay = {
    accounts: count(database, 'identity_account'),
    credentials: count(database, 'identity_password_credential'),
    sessions: count(database, 'identity_session'),
    roles: count(database, 'identity_role_assignment'),
    events: count(database, 'identity_security_event'),
  }
  const replay = await bootstrapLegacyPlatformOwner(db, currentLegacyHash, fields, peppers, {
    now: now + 2,
    fetcher: cleanRange,
  })
  assert.deepEqual(replay, { ok: false, reason: 'unauthorized' })
  assert.deepEqual(
    {
      accounts: count(database, 'identity_account'),
      credentials: count(database, 'identity_password_credential'),
      sessions: count(database, 'identity_session'),
      roles: count(database, 'identity_role_assignment'),
      events: count(database, 'identity_security_event'),
    },
    beforeReplay,
  )

  console.log('legacy owner bootstrap service tests passed')
} finally {
  database.close()
}
