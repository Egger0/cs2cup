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

  console.log('identity account self-registration command passed')
} finally {
  database.close()
}
