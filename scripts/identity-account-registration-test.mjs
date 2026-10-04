import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { registerAccount } = await import('../lib/identity/account-registration.ts')
const { createModeratedIdentityFixture } = await import('./moderated-identity-schema-fixture.mjs')

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
const { database } = fixture
const db = d1Adapter(database)
const pepper = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) }
const peppers = { active: pepper, byVersion: new Map([[1, pepper]]) }
const fields = {
  username: 'new.player',
  displayName: '新参赛者',
  password: '一段不会重复使用的安全长密码 2026',
  passwordConfirmation: '一段不会重复使用的安全长密码 2026',
}
const membership = {
  identityClaim: '学院与学号 20260001',
  contact: 'QQ 123456789',
  applicationReason: '希望参加社团活动',
}

try {
  const created = await registerAccount(db, fields, peppers, {
    now: Date.now(),
  })
  assert.equal(created.ok, true)
  assert.match(created.ok && created.token, /^[A-Za-z0-9_-]{43}$/)
  const account = database
    .prepare(
      `SELECT account.status, account.verification_state, password.username,
              registration.consumed_at, session.auth_method
       FROM identity_account AS account
       JOIN identity_password_credential AS password ON password.account_id = account.id
       JOIN identity_self_registration AS registration ON registration.id = password.self_registration_id
       JOIN identity_session AS session ON session.account_id = account.id
       WHERE account.id = ?`,
    )
    .get(created.ok ? created.accountId : '')
  assert.deepEqual(
    { ...account },
    {
      status: 'active',
      verification_state: 'legacy_unverified',
      username: fields.username,
      consumed_at: account.consumed_at,
      auth_method: 'password',
    },
  )
  assert.equal(typeof account.consumed_at, 'number')
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM identity_membership`).get().count, 0)

  const duplicate = await registerAccount(db, fields, peppers, {
    now: Date.now() + 1,
  })
  assert.deepEqual(duplicate, { ok: false, reason: 'username_unavailable' })

  const contextual = await registerAccount(
    db,
    {
      ...fields,
      username: 'other.player',
      password: 'other.player-2026',
      passwordConfirmation: 'other.player-2026',
    },
    peppers,
    { now: Date.now() + 2 },
  )
  assert.deepEqual(contextual, {
    ok: false,
    reason: 'invalid_input',
    issue: { field: 'password', reason: 'contains_account_context' },
  })

  const member = await registerAccount(db, { ...fields, username: 'new.member' }, peppers, {
    now: Date.now() + 3,
    membership,
  })
  assert.equal(member.ok, true)
  const application = database
    .prepare(
      `SELECT status, identity_claim, contact, application_reason,
              submission_version, submission_digest, submitted_at
       FROM identity_membership_application WHERE account_id = ?`,
    )
    .get(member.accountId)
  assert.equal(application.status, 'pending')
  assert.equal(application.identity_claim, membership.identityClaim)
  assert.equal(application.contact, membership.contact)
  assert.equal(application.application_reason, membership.applicationReason)
  assert.equal(application.submission_version, 1)
  assert.match(application.submission_digest, /^[0-9a-f]{64}$/)
  assert.equal(typeof application.submitted_at, 'number')
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM identity_membership').get().count, 0)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_security_event
      WHERE target_account_id = ? AND event_type = 'membership.application.submitted'`,
      )
      .get(member.accountId).count,
    1,
  )
  const before = database.prepare('SELECT COUNT(*) AS count FROM identity_account').get().count
  for (const missing of ['identityClaim', 'contact']) {
    const rejected = await registerAccount(db, { ...fields, username: 'invalid.member' }, peppers, {
      membership: { ...membership, [missing]: '' },
    })
    assert.deepEqual(rejected, {
      ok: false,
      reason: 'invalid_input',
      issue: { field: missing, reason: 'too_short' },
    })
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM identity_account').get().count,
      before,
    )
  }
  const duplicateMember = await registerAccount(
    db,
    { ...fields, username: 'new.member' },
    peppers,
    {
      membership,
    },
  )
  assert.deepEqual(duplicateMember, { ok: false, reason: 'username_unavailable' })
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_membership_application
    WHERE account_id = ?`,
      )
      .get(member.accountId).count,
    1,
  )

  const tables = [
    'identity_account',
    'identity_password_credential',
    'identity_self_registration',
    'identity_session',
    'identity_membership_application',
    'identity_security_event',
  ]
  const counts = () =>
    tables.map(table => database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)
  const beforeFailure = counts()
  database.exec(`CREATE TRIGGER test_membership_failure BEFORE INSERT ON identity_membership_application
    WHEN NEW.contact = 'forced failure' BEGIN SELECT RAISE(ABORT, 'test membership write failed'); END`)
  await assert.rejects(
    registerAccount(db, { ...fields, username: 'rollback.member' }, peppers, {
      membership: { ...membership, contact: 'forced failure' },
    }),
    /test membership write failed/,
  )
  assert.deepEqual(
    counts(),
    beforeFailure,
    'A failed application must roll back the account and session',
  )

  console.log('identity account self-registration command passed')
} finally {
  database.close()
}
