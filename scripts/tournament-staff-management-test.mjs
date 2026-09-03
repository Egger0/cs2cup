import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const authModule = dataModule(`
  export async function requireAdmin() {
    globalThis.__staffManagerAuthCalls += 1
    if (globalThis.__staffManagerAuthError) throw globalThis.__staffManagerAuthError
    return { adminId: 1, uid: 'owner' }
  }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() {
    globalThis.__staffManagerBindingCalls += 1
    return globalThis.__staffManagerBindings
  }
`)
const cacheModule = dataModule(`
  export function updateTag(tag) { globalThis.__staffManagerTags.push(tag) }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === '../../auth' || specifier === '@/lib/auth') {
      return { url: authModule, shortCircuit: true }
    }
    if (specifier === '../../cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === '@/lib/queries/admin/tournament-staff') {
      return { url: source('../lib/queries/admin/tournament-staff.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/tournament-staff-management') {
      return { url: source('../lib/tournament-staff-management.ts'), shortCircuit: true }
    }
    if (specifier === 'next/cache') return { url: cacheModule, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

class D1Statement {
  constructor(owner, sql, parameters = []) {
    Object.assign(this, { owner, sql, parameters })
  }
  bind(...parameters) {
    return new D1Statement(this.owner, this.sql, parameters)
  }
  execute(kind) {
    this.owner.queries.push({ kind, sql: this.sql, parameters: this.parameters })
    if (this.owner.failure) {
      const error = this.owner.failure
      this.owner.failure = null
      throw error
    }
    return this.owner.database.prepare(this.sql)
  }
  async first() {
    return this.execute('first').get(...this.parameters) ?? null
  }
  async all() {
    return { results: this.execute('all').all(...this.parameters) }
  }
}

class D1Database {
  constructor(database) {
    Object.assign(this, { database, queries: [], failure: null })
  }
  prepare(sql) {
    return new D1Statement(this, sql)
  }
}

const NOW = 2_000_000_000_000
const HOUR = 3_600_000
const principal = suffix => `p_${suffix.repeat(43)}`
const rowSnapshot = row => ({
  grantedAt: row.granted_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
})
const sqlText = entries => entries.map(entry => entry.sql).join('\n')
const assignmentRow = (database, principalId, tournamentId = 1) =>
  database
    .prepare(
      `SELECT principal_id, granted_at, expires_at, revoked_at FROM tournament_role_assignment
       WHERE tournament_id = ? AND principal_id = ? AND role = 'check_in_operator'`,
    )
    .get(tournamentId, principalId)

const database = await createMigratedDatabase()
const d1 = new D1Database(database)
const originalNow = Date.now
Date.now = () => NOW
Object.assign(globalThis, {
  __staffManagerBindings: { db: d1 },
  __staffManagerAuthCalls: 0,
  __staffManagerAuthError: null,
  __staffManagerBindingCalls: 0,
  __staffManagerTags: [],
})

function addPrincipal(suffix, passkeys = 0) {
  const id = principal(suffix)
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(id, suffix.toUpperCase().repeat(43))
  for (let index = 1; index <= passkeys; index += 1) {
    database
      .prepare(
        `INSERT INTO participant_passkey_credential
         (credential_id, principal_id, public_key, device_type, write_nonce, created_at)
         VALUES (?, ?, ?, 'multiDevice', ?, ?)`,
      )
      .run(
        `private-canary-${suffix}-${index}`,
        id,
        `private-key-${suffix}-${index}`,
        `${suffix}${index}`.padEnd(43, suffix),
        NOW - 10_000,
      )
  }
  return id
}

function addTeam(id, tournamentId, suffix, owner, createdAt) {
  database
    .prepare(
      `INSERT INTO team
       (id,tournament_id,name,tag,captain,contact,dept,note,status,created_at,management_token_hash)
       VALUES (?,?,'Team '||?,upper(?),'Captain '||?,'private-canary',?,'private-canary','approved',?,'private-canary-'||?)`,
    )
    .run(id, tournamentId, suffix, suffix, suffix, `Dept ${suffix}`, createdAt, suffix)
  database
    .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (?, ?)')
    .run(id, owner)
}

try {
  database.exec(`
    INSERT INTO game (id,slug,name) VALUES (1,'cs2','CS2');
    INSERT INTO tournament (id,slug,title,game_id,season,edition,team_cap) VALUES
      (1,'first','First Cup',1,'2026',1,20),(2,'second','Second Cup',1,'2026',2,20);
  `)
  const ids = {
    active: addPrincipal('a', 2),
    cross: addPrincipal('b', 1),
    noPasskey: addPrincipal('c'),
    detached: addPrincipal('d'),
    expired: addPrincipal('e', 1),
    organizer: addPrincipal('f', 1),
    fresh: addPrincipal('g', 1),
    lost: addPrincipal('h', 1),
  }
  addTeam(10, 1, 'a-old', ids.active, '2026-01-01')
  addTeam(11, 1, 'a-new', ids.active, '2026-02-01')
  addTeam(12, 1, 'c', ids.noPasskey, '2026-03-01')
  addTeam(13, 1, 'e', ids.expired, '2026-04-01')
  addTeam(14, 1, 'f', ids.organizer, '2026-05-01')
  addTeam(15, 1, 'g', ids.fresh, '2026-06-01')
  addTeam(16, 1, 'h', ids.lost, '2026-07-01')
  addTeam(20, 2, 'b', ids.cross, '2026-08-01')
  database.exec(`
    INSERT INTO participant_profile VALUES ('${ids.active}','private-canary',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO participant_external_identity (principal_id,provider,issuer,subject)
      VALUES ('${ids.active}','test','private-canary','private-canary');
    INSERT INTO participant_session (token_hash,principal_id,credential_id,created_at,expires_at)
      VALUES ('${'0'.repeat(64)}','${ids.active}','private-canary-a-1',${NOW - 1},${NOW + HOUR});
    INSERT INTO tournament_role_assignment VALUES
      (1,'${ids.active}','check_in_operator',${NOW - 100},${NOW + HOUR},NULL),
      (1,'${ids.detached}','check_in_operator',${NOW - 200},${NOW + HOUR},${NOW - 50}),
      (1,'${ids.expired}','check_in_operator',${NOW - 300},${NOW - 1},NULL),
      (1,'${ids.organizer}','organizer',${NOW - 400},NULL,NULL),
      (1,'${ids.organizer}','check_in_operator',${NOW - 450},${NOW + HOUR},NULL),
      (2,'${ids.cross}','check_in_operator',${NOW - 500},${NOW + HOUR},NULL);
  `)

  const query = await import('../lib/queries/admin/tournament-staff.ts')
  const action = await import('../app/admin/(console)/actions/tournament-staff.ts')
  const { hasStaffCapability } = await import('../lib/authorization.ts')
  const grant = (...args) => action.grantCheckInOperator(...args)
  const revoke = (...args) => action.revokeCheckInOperator(...args)
  const resource = { kind: 'tournament', tournamentId: 1 }
  const writeCapability = 'tournament.check_in.write'
  const canCheckIn = principalId =>
    hasStaffCapability(d1, { kind: 'participant', principalId }, writeCapability, resource, NOW)

  const denied = new Error('admin denied')
  const isDenied = error => error === denied
  globalThis.__staffManagerAuthError = denied
  const deniedCounts = [d1.queries.length, globalThis.__staffManagerBindingCalls]
  await assert.rejects(() => query.getTournamentCheckInOperatorManager(0), isDenied)
  await assert.rejects(() => grant(0, 'bad', 12, null), isDenied)
  assert.deepEqual([d1.queries.length, globalThis.__staffManagerBindingCalls], deniedCounts)
  assert.deepEqual(globalThis.__staffManagerTags, [])
  globalThis.__staffManagerAuthError = null

  const invalidReads = d1.queries.length
  assert.equal(await query.getTournamentCheckInOperatorManager(0), null)
  assert.equal((await grant(1, ids.fresh, 12, null)).code, 'invalid')
  assert.equal((await revoke(1, ids.active, { grantedAt: -1 })).code, 'invalid')
  assert.equal(d1.queries.length, invalidReads)

  const readStart = d1.queries.length
  const manager = await query.getTournamentCheckInOperatorManager(1)
  const { assignments, candidates } = manager
  assert.equal(Object.keys(candidates[0]).sort().join(','), 'principalId,reference,team')
  assert.equal(
    Object.keys(assignments[0]).sort().join(','),
    'active,expiresAt,grantedAt,principalId,reference,revokedAt,snapshot,team',
  )
  assert.equal(candidates.filter(item => item.principalId === ids.active).length, 1)
  assert.equal(candidates.find(item => item.principalId === ids.active).team.id, 11)
  for (const excluded of [ids.noPasskey, ids.cross, ids.organizer]) {
    assert.equal(
      candidates.some(item => item.principalId === excluded),
      false,
    )
  }
  assert.equal(assignments.find(item => item.principalId === ids.detached).team, null)
  assert.equal(assignments.find(item => item.principalId === ids.organizer).team?.id, 14)
  assert.equal(assignments.find(item => item.principalId === ids.expired).active, false)
  assert.equal(
    assignments.some(item => item.principalId === ids.cross),
    false,
  )
  assert.doesNotMatch(JSON.stringify(manager), /private-canary|private-key/)
  const readSql = sqlText(d1.queries.slice(readStart))
  assert.doesNotMatch(
    readSql,
    /SELECT\s+\*|contact|note|management_token|webauthn_user_handle|credential_id|public_key|transports_json|write_nonce|participant_(?:profile|external_identity|session)/i,
  )

  for (const excluded of [ids.cross, ids.noPasskey, ids.organizer]) {
    assert.equal((await grant(1, excluded, 8, null)).code, 'conflict')
  }
  database
    .prepare('DELETE FROM participant_passkey_credential WHERE principal_id = ?')
    .run(ids.lost)
  assert.equal((await grant(1, ids.lost, 8, null)).code, 'conflict')
  assert.deepEqual(globalThis.__staffManagerTags, [])

  const authBeforeGrant = globalThis.__staffManagerAuthCalls
  const granted = await grant(1, ids.fresh, 8, null)
  assert.equal(granted.ok, true)
  assert.equal(globalThis.__staffManagerAuthCalls - authBeforeGrant, 2)
  const storedGrant = assignmentRow(database, ids.fresh)
  assert.equal(storedGrant.granted_at, NOW)
  assert.equal(storedGrant.expires_at, NOW + 8 * HOUR)
  assert.equal(await canCheckIn(ids.fresh), true)
  const firstGrant = granted.assignment.snapshot
  assert.equal((await grant(1, ids.fresh, 8, null)).code, 'conflict')

  const expired = rowSnapshot(assignmentRow(database, ids.expired))
  assert.equal((await grant(1, ids.expired, 8, null)).code, 'conflict')
  const renewedExpired = await grant(1, ids.expired, 24, expired)
  assert.equal(renewedExpired.ok, true)
  assert.equal(renewedExpired.assignment.expiresAt, NOW + 24 * HOUR)
  assert.equal((await grant(1, ids.expired, 8, expired)).code, 'conflict')

  const stale = { ...firstGrant, expiresAt: firstGrant.expiresAt + 1 }
  assert.equal((await revoke(1, ids.fresh, stale)).code, 'conflict')
  assert.equal((await revoke(2, ids.fresh, firstGrant)).code, 'conflict')
  assert.equal(await canCheckIn(ids.fresh), true)
  const revoked = await revoke(1, ids.fresh, firstGrant)
  assert.equal(revoked.ok, true)
  assert.equal(await canCheckIn(ids.fresh), false)
  assert.equal((await revoke(1, ids.fresh, revoked.assignment.snapshot)).code, 'conflict')
  const renewed = await grant(1, ids.fresh, 8, revoked.assignment.snapshot)
  assert.equal(renewed.ok, true)
  assert.ok(renewed.assignment.grantedAt > revoked.assignment.revokedAt)
  assert.equal((await revoke(1, ids.fresh, firstGrant)).code, 'conflict')
  assert.equal(await canCheckIn(ids.fresh), true)
  assert.equal((await revoke(1, ids.fresh, renewed.assignment.snapshot)).ok, true)
  assert.equal(await canCheckIn(ids.fresh), false)

  const tagsBeforeFailure = globalThis.__staffManagerTags.length
  d1.failure = new Error('private-canary-database')
  const originalConsoleError = console.error
  console.error = () => {}
  const unavailable = await grant(1, ids.cross, 8, null)
  console.error = originalConsoleError
  assert.equal(unavailable.code, 'unavailable')
  assert.doesNotMatch(JSON.stringify(unavailable), /private-canary/)
  assert.equal(globalThis.__staffManagerTags.length, tagsBeforeFailure)

  const insertSql = d1.queries.find(entry =>
    entry.sql.includes('INSERT INTO tournament_role_assignment'),
  ).sql
  const regrantSql = d1.queries.find(entry => entry.sql.includes('SET granted_at =')).sql
  const revokeSql = d1.queries.find(entry => entry.sql.includes('SET revoked_at =')).sql
  assert.match(insertSql, /INSERT[\s\S]*SELECT[\s\S]*ON CONFLICT[\s\S]*DO NOTHING[\s\S]*RETURNING/)
  assert.doesNotMatch(insertSql, /REPLACE|DO UPDATE/i)
  assert.match(regrantSql, /granted_at = \?[\s\S]*expires_at IS \?[\s\S]*revoked_at IS \?/)
  assert.match(
    revokeSql,
    /role = 'check_in_operator'[\s\S]*granted_at = \?[\s\S]*revoked_at IS NULL/,
  )
  assert.equal(
    d1.queries.some(entry => /DELETE FROM tournament_role_assignment/i.test(entry.sql)),
    false,
  )

  console.log('tournament staff management query and action tests passed')
} finally {
  Date.now = originalNow
  for (const key of Object.getOwnPropertyNames(globalThis).filter(key =>
    key.startsWith('__staffManager'),
  ))
    delete globalThis[key]
  database.close()
}
