import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { migrateLegacyParticipantCredential } =
  await import('../lib/identity/legacy-participant-migration.ts')

const now = 2_000_000_000_000
const credentials = Array.from({ length: 20 }, (_, index) => ({
  credential_id: `budget-credential-${index}`,
  public_key: 'YQ',
  counter: index,
  transports_json: '[]',
  device_type: 'multiDevice',
  backed_up: 0,
  revision: index,
  created_at: now - 1_000 + index,
  last_used_at: null,
}))
const entries = Array.from({ length: 200 }, (_, index) => ({ team_id: index + 1 }))
const roles = Array.from({ length: 100 }, (_, index) => ({
  tournament_id: index + 1,
  role: ['organizer', 'referee', 'check_in_operator'][index % 3],
  granted_at: now - 1_000,
  expires_at: null,
}))

class BudgetStatement {
  constructor(owner, sql, bindings = []) {
    Object.assign(this, { owner, sql, bindings })
  }

  bind(...bindings) {
    return new BudgetStatement(this.owner, this.sql, bindings)
  }

  async first() {
    this.owner.readQueries += 1
    if (this.sql.includes('JOIN participant_principal AS principal')) {
      return {
        principal_id: `p_${'p'.repeat(43)}`,
        webauthn_user_handle: 'h'.repeat(43),
        display_name: 'Budget participant',
        captain_name: null,
        created_at: '2026-01-01 00:00:00',
      }
    }
    if (this.sql.includes('FROM identity_legacy_subject_map')) return null
    if (this.sql.includes('FROM identity_account WHERE webauthn_user_handle')) return null
    throw new Error(`Unexpected first query: ${this.sql}`)
  }

  async all() {
    this.owner.readQueries += 1
    if (this.sql.includes('SELECT credential_id, public_key')) return { results: credentials }
    if (this.sql.includes('SELECT team_id FROM tournament_entry_owner')) {
      return { results: entries }
    }
    if (this.sql.includes('SELECT tournament_id, role')) return { results: roles }
    throw new Error(`Unexpected all query: ${this.sql}`)
  }
}

class BudgetDatabase {
  readQueries = 0
  batchStatements = []

  prepare(sql) {
    return new BudgetStatement(this, sql)
  }

  async batch(statements) {
    this.batchStatements = statements
    return statements.map(() => ({}))
  }
}

const database = new BudgetDatabase()
assert.match(
  (await migrateLegacyParticipantCredential(database, 'budget-credential-0', now)) ?? '',
  /^[A-Za-z0-9_-]{43}$/,
)
assert.equal(database.readQueries, 6)
assert.equal(
  database.batchStatements.filter(statement =>
    statement.sql.includes('INSERT INTO identity_passkey_credential'),
  ).length,
  20,
)
assert.equal(
  database.batchStatements.filter(statement =>
    statement.sql.includes('INSERT INTO identity_registration_membership'),
  ).length,
  1,
)
assert.equal(
  database.batchStatements.filter(statement =>
    statement.sql.includes('INSERT INTO identity_role_assignment'),
  ).length,
  1,
)
assert.equal(database.readQueries + database.batchStatements.length, 33)
assert.ok(database.readQueries + database.batchStatements.length < 50)

console.log('identity legacy participant D1 query budget tests passed')
