import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const authModule = dataModule(`
  export async function requireTournamentStaffCapability(tournamentId, capability) {
    globalThis.__staffQueryAuthCalls.push({ tournamentId, capability })
    if (globalThis.__staffQueryDenied) throw new Error('staff access denied')
    return globalThis.__staffQueryActor
  }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__staffQueryBindings }
`)
const participantModule = dataModule(`
  export async function getCurrentParticipant() { return globalThis.__staffQueryParticipant }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../auth') return { url: authModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === '../participant-auth') {
      return { url: participantModule, shortCircuit: true }
    }
    if (specifier === '../authorization') {
      return { url: source('../lib/authorization.ts'), shortCircuit: true }
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

  async first() {
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return this.owner.database.prepare(this.sql).get(...this.parameters) ?? null
  }

  async all() {
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return { results: this.owner.database.prepare(this.sql).all(...this.parameters) }
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

const principalId = `p_${'A'.repeat(43)}`
const now = Date.now()
const database = await createMigratedDatabase()

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, season, edition, status, team_cap)
    VALUES
      (1, 'first', 'First Cup', '2026', 1, 'running', 8),
      (2, 'second', 'Second Cup', '2026', 2, 'registration', 8),
      (3, 'third', 'Third Cup', '2027', 1, 'draft', 8);
    INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, dept, note, status, created_at)
    VALUES
      (10, 1, 'Alpha', 'AAA', 'Captain A', 'contact-canary-a', '信息学院', 'note-canary-a', 'approved', '2026-01-01 00:00:00'),
      (11, 1, 'Pending', 'WAIT', 'Captain P', 'contact-canary-p', NULL, 'note-canary-p', 'pending', '2025-01-01 00:00:00'),
      (12, 1, 'Bravo', 'BBB', 'Captain B', 'contact-canary-b', NULL, 'note-canary-b', 'approved', '2026-01-02 00:00:00'),
      (20, 2, 'Other', 'OTH', 'Captain O', 'contact-canary-o', NULL, 'note-canary-o', 'approved', '2026-01-01 00:00:00');
    INSERT INTO participant_principal (id, webauthn_user_handle)
    VALUES ('${principalId}', '${'U'.repeat(43)}');
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at)
    VALUES
      (1, '${principalId}', 'organizer', ${now - 2_000}),
      (1, '${principalId}', 'check_in_operator', ${now - 2_000});
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at, revoked_at)
    VALUES (2, '${principalId}', 'check_in_operator', ${now - 2_000}, ${now - 1_000});
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at, expires_at)
    VALUES (3, '${principalId}', 'organizer', ${now - 2_000}, ${now - 1_000});
  `)

  const d1 = new D1Database(database)
  globalThis.__staffQueryBindings = { db: d1 }
  globalThis.__staffQueryAuthCalls = []
  globalThis.__staffQueryDenied = false
  globalThis.__staffQueryActor = {
    kind: 'participant',
    principalId,
    sessionExpiresAt: now + 60_000,
  }
  globalThis.__staffQueryParticipant = {
    principalId,
    credentialId: 'credential',
    sessionExpiresAt: now + 60_000,
  }

  const { getTournamentCheckInDesk, listCurrentParticipantCheckInWorkspaces } =
    await import('../lib/queries/staff-check-in.ts')
  const desk = await getTournamentCheckInDesk(1)
  assert.deepEqual(globalThis.__staffQueryAuthCalls, [
    { tournamentId: 1, capability: 'tournament.check_in.read' },
  ])
  assert.deepEqual(
    desk.teams.map(team => team.id),
    [10, 12],
    'pending teams are excluded and stable registration order is preserved',
  )
  assert.deepEqual(Object.keys(desk.teams[0]).sort(), [
    'captain',
    'checkedInAt',
    'dept',
    'id',
    'name',
    'tag',
    'tournamentId',
  ])
  assert.equal(JSON.stringify(desk).includes('canary'), false)
  const deskQueries = d1.queries
    .slice(0, 2)
    .map(query => query.sql)
    .join('\n')
  assert.doesNotMatch(deskQueries, /contact|note|management|player|seed|SELECT\s+\*/i)
  assert.match(deskQueries, /status = 'approved'/)

  globalThis.__staffQueryDenied = true
  const deniedQueryCount = d1.queries.length
  await assert.rejects(() => getTournamentCheckInDesk(2), /staff access denied/)
  assert.equal(d1.queries.length, deniedQueryCount, 'authorization runs before private reads')
  globalThis.__staffQueryDenied = false

  const workspaces = await listCurrentParticipantCheckInWorkspaces()
  assert.deepEqual(
    workspaces.map(workspace => workspace.id),
    [1],
    'workspace discovery removes duplicates, expired grants and revoked grants',
  )
  const workspaceQuery = d1.queries.at(-1)
  assert.equal(workspaceQuery.parameters[0], principalId)
  assert.doesNotMatch(
    workspaceQuery.sql,
    /participant_profile|external_identity|credential|session/,
  )

  globalThis.__staffQueryParticipant = null
  const anonymousQueryCount = d1.queries.length
  assert.deepEqual(await listCurrentParticipantCheckInWorkspaces(), [])
  assert.equal(d1.queries.length, anonymousQueryCount)

  console.log('staff check-in narrow query tests passed')
} finally {
  delete globalThis.__staffQueryBindings
  delete globalThis.__staffQueryAuthCalls
  delete globalThis.__staffQueryDenied
  delete globalThis.__staffQueryActor
  delete globalThis.__staffQueryParticipant
  database.close()
}
