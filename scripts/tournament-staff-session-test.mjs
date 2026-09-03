import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__staffSessionBindings }
`)
const cookiesModule = dataModule(`
  export async function cookies() {
    return {
      get(name) {
        const value = globalThis.__staffSessionCookies[name]
        return value ? { value } : undefined
      },
      delete() {},
    }
  }
`)
const navigationModule = dataModule(`
  export function redirect(path) { throw Object.assign(new Error('redirect'), { path }) }
  export function notFound() { throw new Error('not-found') }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === 'next/navigation') return { url: navigationModule, shortCircuit: true }
    if (specifier === './cloudflare-bindings') {
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

  async first() {
    if (this.owner.failAuthorization && /(?:platform|tournament)_role_assignment/.test(this.sql)) {
      throw new Error('authorization database unavailable')
    }
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return this.owner.database.prepare(this.sql).get(...this.parameters) ?? null
  }
}

class D1Database {
  constructor(database) {
    this.database = database
    this.queries = []
    this.failAuthorization = false
  }

  prepare(sql) {
    return new D1Statement(this, sql)
  }
}

const now = Date.now()
const principal = suffix => `p_${suffix.repeat(43)}`
const token = suffix => suffix.repeat(43)
const hash = value => createHash('sha256').update(value).digest('hex')
const adminToken = 'owner-session-token'
const database = await createMigratedDatabase()

function insertParticipant(suffix) {
  const id = principal(suffix)
  const credentialId = `credential-${suffix}`
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(id, suffix.toLowerCase().repeat(43))
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, device_type, created_at)
       VALUES (?, ?, ?, 'multiDevice', ?)`,
    )
    .run(credentialId, id, suffix.repeat(8), now - 2_000)
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash(token(suffix)), id, credentialId, now - 1_000, now + 60_000)
}

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, season, edition, status, team_cap)
    VALUES
      (1, 'first', 'First Cup', '2026', 1, 'running', 8),
      (2, 'second', 'Second Cup', '2026', 2, 'registration', 8);
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'owner', 'salt', 'hash');
    INSERT INTO admin_session (token_hash, admin_id, expires_at)
    VALUES ('${hash(adminToken)}', 1, ${now + 60_000});
  `)
  for (const suffix of ['A', 'B', 'C']) insertParticipant(suffix)
  database.exec(`
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at)
    VALUES
      (1, '${principal('A')}', 'check_in_operator', ${now - 1_000}),
      (1, '${principal('B')}', 'referee', ${now - 1_000});
  `)

  const d1 = new D1Database(database)
  globalThis.__staffSessionBindings = { db: d1 }
  globalThis.__staffSessionCookies = {}
  const auth = await import('../lib/auth.ts?staff-session')
  const access = (tournamentId, capability = 'tournament.check_in.read') =>
    auth.getCurrentTournamentStaffAccess(tournamentId, capability)

  assert.equal((await access(1)).reason, 'anonymous')

  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('Z') }
  const expired = await access(1)
  assert.equal(expired.reason, 'expired')
  assert.equal(expired.hadParticipantCookie, true)

  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('A') }
  const participantAccess = await access(1)
  assert.equal(participantAccess.ok, true)
  assert.equal(participantAccess.actor.kind, 'participant')
  assert.equal(participantAccess.actor.principalId, principal('A'))
  assert.equal((await access(1, 'tournament.check_in.write')).ok, true)
  assert.equal((await access(2)).reason, 'forbidden')

  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('B') }
  assert.equal((await access(1)).reason, 'forbidden', 'referees cannot read check-in data')

  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('C') }
  assert.equal((await access(1)).reason, 'forbidden')

  globalThis.__staffSessionCookies = { cs2cup_admin: adminToken }
  const ownerAccess = await access(2)
  assert.equal(ownerAccess.ok, true)
  assert.equal(ownerAccess.actor.kind, 'admin')

  globalThis.__staffSessionCookies = {
    '__Host-cs2cup_participant': token('A'),
    cs2cup_admin: adminToken,
  }
  assert.equal((await access(1)).reason, 'conflict', 'two authenticated subjects fail closed')

  globalThis.__staffSessionCookies = {
    '__Host-cs2cup_participant': token('C'),
    cs2cup_admin: adminToken,
  }
  assert.equal((await access(1)).reason, 'conflict', 'authorization cannot choose between subjects')

  globalThis.__staffSessionCookies = {
    '__Host-cs2cup_participant': token('Z'),
    cs2cup_admin: adminToken,
  }
  assert.equal(
    (await access(1)).actor.kind,
    'admin',
    'an expired participant session cannot mask owner',
  )

  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('A') }
  assert.equal((await access(1)).ok, true)
  database.prepare('UPDATE tournament_role_assignment SET revoked_at = ?').run(now)
  assert.equal((await access(1)).reason, 'forbidden', 'revocation must be observed immediately')

  globalThis.__staffSessionCookies = {
    '__Host-cs2cup_participant': token('A'),
    cs2cup_admin: adminToken,
  }
  assert.equal(
    (await access(1)).reason,
    'conflict',
    'a revoked role does not make a second authenticated subject safe',
  )

  database.prepare('UPDATE tournament_role_assignment SET revoked_at = NULL').run()
  globalThis.__staffSessionCookies = { '__Host-cs2cup_participant': token('A') }
  const forged = await auth.getCurrentTournamentStaffAccess(1, 'tournament.check_in.read', {
    principalId: principal('B'),
  })
  assert.equal(forged.actor.principalId, principal('A'), 'extra client data must be ignored')

  d1.failAuthorization = true
  await assert.rejects(() => access(1), /authorization database unavailable/)

  console.log('tournament staff session binding tests passed')
} finally {
  delete globalThis.__staffSessionBindings
  delete globalThis.__staffSessionCookies
  database.close()
}
