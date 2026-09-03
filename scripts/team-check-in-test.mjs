import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const authSource = `
  export class TournamentStaffAccessError extends Error {}
  export async function requireAdmin() { return { uid: 'test' } }
  export async function requireTournamentStaffCapability(tournamentId, capability) {
    globalThis.__teamAuthCalls.push({ kind: 'require', tournamentId, capability })
    if (globalThis.__teamAuthRejectInner) throw new TournamentStaffAccessError()
    return { kind: 'admin', adminId: 1 }
  }
  export async function getCurrentTournamentStaffAccess(tournamentId, capability) {
    globalThis.__teamAuthCalls.push({ kind: 'access', tournamentId, capability })
    return globalThis.__teamStaffAccess
  }
`
const authModule = `data:text/javascript,${encodeURIComponent(authSource)}`
const bindingsModule =
  'data:text/javascript,export function cloudflareBindings(){return globalThis.__teamCheckInBindings}'
const actionsQueryModule = `data:text/javascript,${encodeURIComponent(`
  function call(name, args) {
    globalThis.__teamActionCalls.push({ name, args })
    if (name === 'setTeamCheckedIn' && globalThis.__teamActionError) {
      throw globalThis.__teamActionError
    }
    return globalThis.__teamActionRows[name] ?? []
  }
  export async function assignTeamSeed(...args) { return call('assignTeamSeed', args) }
  export async function removeTeam(...args) { return call('removeTeam', args) }
  export async function setTeamCheckedIn(...args) { return call('setTeamCheckedIn', args) }
  export async function setTeamStatus(...args) { return call('setTeamStatus', args) }
`)}`
const cacheModule =
  'data:text/javascript,export function updateTag(tag){globalThis.__teamActionTags.push(tag)}'
const errorsModule =
  'data:text/javascript,export function writeError(_error,fallback){return fallback}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../../auth') return { url: authModule, shortCircuit: true }
    if (specifier === '@/lib/auth') return { url: authModule, shortCircuit: true }
    if (specifier === '@/lib/datetime') {
      return { url: source('../lib/datetime.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/queries/admin') {
      return { url: actionsQueryModule, shortCircuit: true }
    }
    if (specifier === 'next/cache') return { url: cacheModule, shortCircuit: true }
    if (specifier === './_errors') return { url: errorsModule, shortCircuit: true }
    if (specifier === './cloudflare-bindings' || specifier === '../../cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
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
    this.owner = owner
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new D1Statement(this.owner, this.sql, parameters)
  }

  async all() {
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return { results: this.owner.database.prepare(this.sql).all(...this.parameters) }
  }

  async run() {
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return this.owner.database.prepare(this.sql).run(...this.parameters)
  }
}

class D1Database {
  constructor(database) {
    this.database = database
    this.queries = []
  }

  prepare(sql) {
    return new D1Statement(this, sql)
  }
}

const { listTeamsWithContact, removeTeam, setTeamCheckedIn, setTeamStatus } =
  await import('../lib/queries/admin/teams.ts')

const database = await createMigratedDatabase()

globalThis.__teamAuthCalls = []
globalThis.__teamAuthRejectInner = false
globalThis.__teamStaffAccess = { ok: true, actor: { kind: 'admin', adminId: 1 } }

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, team_cap)
    VALUES
      (1, 'one', 'One', 1, '2026', 1, 8),
      (2, 'two', 'Two', 1, '2026', 2, 8);
    INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, status, seed, checked_in_at)
    VALUES
      (10, 1, 'Alpha', 'A', 'Captain A', 'a', 'approved', 1, NULL),
      (11, 1, 'Bravo', 'B', 'Captain B', 'b', 'pending', NULL, NULL),
      (20, 2, 'Other', 'O', 'Captain O', 'o', 'approved', 1, NULL);
    INSERT INTO player (id, team_id, nickname, is_substitute, sort_order)
    VALUES
      (1, 10, 'Second', 0, 2),
      (2, 10, 'First', 0, 1),
      (3, 20, 'Private', 0, 1);
  `)

  const d1 = new D1Database(database)
  globalThis.__teamCheckInBindings = { db: d1 }

  const teams = await listTeamsWithContact(1)
  assert.deepEqual(
    teams.map(team => team.id),
    [10, 11],
  )
  assert.deepEqual(
    teams[0].players.map(player => player.nickname),
    ['First', 'Second'],
  )
  assert.equal(teams[0].checkedInAt, null)

  const rosterQuery = d1.queries.find(query => query.sql.includes('LEFT JOIN player'))
  assert.match(rosterQuery.sql, /WHERE t\.tournament_id = \?/)
  assert.deepEqual(rosterQuery.parameters, [1])
  assert.equal(d1.queries.filter(query => query.sql.includes('FROM player')).length, 0)

  globalThis.__teamAuthRejectInner = true
  const deniedQueryCount = d1.queries.length
  await assert.rejects(() => setTeamCheckedIn(10, 1, true, null))
  assert.equal(d1.queries.length, deniedQueryCount, 'denied check-in must not reach D1')
  globalThis.__teamAuthRejectInner = false

  const checkedInRows = await setTeamCheckedIn(10, 1, true, null)
  assert.equal(checkedInRows.length, 1)
  assert.deepEqual(Object.keys(checkedInRows[0]).sort(), ['checked_in_at', 'id', 'tournament_id'])
  const checkInQuery = d1.queries.find(query => query.sql.includes('UPDATE team'))
  assert.doesNotMatch(checkInQuery.sql, /contact|note|seed|\*/i)
  assert.match(checkInQuery.sql, /id = \?[\s\S]*tournament_id = \?[\s\S]*status = 'approved'/)
  const firstCheckIn = checkedInRows[0].checked_in_at
  assert.equal(typeof firstCheckIn, 'string')
  assert.equal((await setTeamCheckedIn(10, 1, true, null)).length, 0)

  const newerCheckIn = '2099-01-01T00:00:00.000Z'
  database.prepare('UPDATE team SET checked_in_at = ? WHERE id = 10').run(newerCheckIn)
  assert.equal((await setTeamCheckedIn(10, 1, false, firstCheckIn)).length, 0)
  assert.equal(
    database.prepare('SELECT checked_in_at FROM team WHERE id = 10').get().checked_in_at,
    newerCheckIn,
  )
  assert.equal((await setTeamCheckedIn(10, 1, false, newerCheckIn)).length, 1)

  assert.equal((await setTeamCheckedIn(20, 1, true, null)).length, 0)
  assert.equal((await setTeamCheckedIn(11, 1, true, null)).length, 0)

  database.prepare("UPDATE team SET checked_in_at = '2099-01-02', seed = 2 WHERE id = 10").run()
  assert.equal((await setTeamStatus(10, 2, 'rejected')).length, 0)
  assert.equal((await setTeamStatus(10, 1, 'rejected')).length, 1)
  const rejected = database
    .prepare('SELECT status, seed, checked_in_at FROM team WHERE id = 10')
    .get()
  assert.deepEqual({ ...rejected }, { status: 'rejected', seed: null, checked_in_at: null })

  assert.equal((await removeTeam(10, 2)).length, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM team WHERE id = 10').get().count, 1)
  assert.equal((await removeTeam(10, 1)).length, 1)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM team WHERE id = 10').get().count, 0)

  console.log('Team check-in tests passed')
} finally {
  database.close()
}

globalThis.__teamActionCalls = []
globalThis.__teamActionRows = {}
globalThis.__teamActionTags = []
globalThis.__teamActionError = null

const { deleteTeam, updateTeamCheckIn, updateTeamStatus } =
  await import('../app/admin/(console)/actions/teams.ts')

assert.equal((await updateTeamCheckIn(0, true, null, 1)).ok, false)
assert.equal((await updateTeamCheckIn(1, 'true', null, 1)).ok, false)
assert.equal((await updateTeamCheckIn(1, false, 'invalid', 1)).ok, false)
assert.equal((await updateTeamCheckIn(1, true, '2026-08-31T00:00:00.000Z', 1)).ok, false)
assert.equal((await updateTeamStatus(1, 'deleted', 1)).ok, false)
assert.equal(globalThis.__teamActionCalls.length, 0)
assert.equal(globalThis.__teamAuthCalls.filter(call => call.kind === 'access').length, 0)

globalThis.__teamStaffAccess = {
  ok: false,
  reason: 'forbidden',
  hadAdminCookie: false,
  hadParticipantCookie: true,
}
const denied = await updateTeamCheckIn(1, true, null, 7)
assert.equal(denied.code, 'forbidden')
assert.equal(globalThis.__teamActionCalls.length, 0)
assert.deepEqual(globalThis.__teamActionTags, [])

globalThis.__teamStaffAccess = { ok: true, actor: { kind: 'participant', principalId: 'test' } }

const auth = await import(authModule)
globalThis.__teamActionError = new auth.TournamentStaffAccessError()
const innerDenied = await updateTeamCheckIn(1, true, null, 7)
assert.equal(innerDenied.code, 'forbidden')
assert.deepEqual(globalThis.__teamActionTags, [])
globalThis.__teamActionError = null

const conflict = await updateTeamCheckIn(1, true, null, 7)
assert.equal(conflict.ok, false)
assert.match(conflict.error, /同步/)

const checkInInstant = '2026-09-03T04:00:00.000Z'
globalThis.__teamActionRows.setTeamCheckedIn = [{ id: 1, checked_in_at: checkInInstant }]
const checkInSuccess = await updateTeamCheckIn(1, true, null, 7)
assert.equal(checkInSuccess.ok, true)
assert.equal(checkInSuccess.checkedInAt, checkInInstant)
assert.deepEqual(globalThis.__teamActionCalls.at(-1), {
  name: 'setTeamCheckedIn',
  args: [1, 7, true, null],
})
assert.deepEqual(globalThis.__teamActionTags, ['teams:7'])
assert.deepEqual(globalThis.__teamAuthCalls.filter(call => call.kind === 'access').at(-1), {
  kind: 'access',
  tournamentId: 7,
  capability: 'tournament.check_in.write',
})

globalThis.__teamActionRows.setTeamStatus = [{ id: 1 }]
assert.equal((await updateTeamStatus(1, 'approved', 7)).ok, true)
assert.deepEqual(globalThis.__teamActionCalls.at(-1), {
  name: 'setTeamStatus',
  args: [1, 7, 'approved'],
})

assert.equal((await deleteTeam(1, 7)).ok, false)
globalThis.__teamActionRows.removeTeam = [{ id: 1 }]
assert.equal((await deleteTeam(1, 7)).ok, true)
assert.deepEqual(globalThis.__teamActionCalls.at(-1), {
  name: 'removeTeam',
  args: [1, 7],
})

console.log('Team action tests passed')
