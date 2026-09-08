import assert from 'node:assert/strict'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

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

const opaque = character => character.repeat(43)
const CAPTAIN = opaque('C')
const CLAIMANT = opaque('D')
const OTHER = opaque('E')
const STRANGER = opaque('F')
const STAFF = opaque('G')

const database = await createMigratedDatabase()
const db = d1Adapter(database)

const { claimRosterSeat } = await import('../lib/identity/roster-claim.ts')

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'roster', 'Roster', 1, '2026', 1, 'registration', 4);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES (1, 1, 'Alpha', 'AAA', 'Captain', 'contact');
    INSERT INTO player (id, team_id, nickname, sort_order) VALUES (1, 1, 'Aster', 1);
    INSERT INTO player (id, team_id, nickname, sort_order) VALUES (2, 1, 'Flint', 2);
    INSERT INTO player (id, team_id, nickname, sort_order) VALUES (3, 1, 'Grove', 3);
  `)
  for (const [id, handle] of [
    [CAPTAIN, opaque('c')],
    [CLAIMANT, opaque('d')],
    [OTHER, opaque('e')],
    [STRANGER, opaque('f')],
    [STAFF, opaque('g')],
  ]) {
    database.exec(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES ('${id}', '${handle}', 'Person', 'active', 'verified', 1, 1)`,
    )
  }
  database.exec(
    `INSERT INTO identity_registration_membership
       (id, team_id, account_id, relationship, grant_reason, granted_at)
     VALUES ('${opaque('o')}', 1, '${CAPTAIN}', 'owner', 'entry', 1)`,
  )
  database.exec(
    `INSERT INTO identity_role_assignment
       (id, account_id, role, scope_type, scope_tournament_id, grant_reason, granted_at)
     VALUES ('${opaque('s')}', '${STAFF}', 'check_in_operator', 'tournament', 1, 'desk', 1)`,
  )

  const rows = () =>
    database.prepare('SELECT COUNT(*) AS n FROM identity_registration_membership').get().n

  const captainClaim = await claimRosterSeat(db, {
    playerId: 1,
    accountId: CLAIMANT,
    authorisedByAccountId: CAPTAIN,
    reason: 'Captain confirmed at registration',
    now: 100,
  })
  assert.equal(captainClaim.ok, true, 'the captain may confirm a seat on their own entry')
  assert.match(captainClaim.membershipId, /^[A-Za-z0-9_-]{43}$/)

  const staffClaim = await claimRosterSeat(db, {
    playerId: 2,
    accountId: OTHER,
    authorisedByAccountId: STAFF,
    reason: 'Verified at check-in',
    now: 100,
  })
  assert.equal(staffClaim.ok, true, 'check-in staff may confirm a seat')

  assert.deepEqual(
    await claimRosterSeat(db, {
      playerId: 3,
      accountId: CLAIMANT,
      authorisedByAccountId: STRANGER,
      reason: 'Unrelated account',
      now: 100,
    }),
    { ok: false, reason: 'not_authorised' },
  )

  assert.deepEqual(
    await claimRosterSeat(db, {
      playerId: 3,
      accountId: CLAIMANT,
      authorisedByAccountId: CLAIMANT,
      reason: 'Self service',
      now: 100,
    }),
    { ok: false, reason: 'self_authorised' },
  )

  assert.deepEqual(
    await claimRosterSeat(db, {
      playerId: 1,
      accountId: OTHER,
      authorisedByAccountId: CAPTAIN,
      reason: 'Second claimant',
      now: 200,
    }),
    { ok: false, reason: 'seat_taken' },
  )

  assert.deepEqual(
    await claimRosterSeat(db, {
      playerId: 999,
      accountId: CLAIMANT,
      authorisedByAccountId: CAPTAIN,
      reason: 'No such seat',
      now: 200,
    }),
    { ok: false, reason: 'seat_missing' },
  )

  const before = rows()
  const repeated = await claimRosterSeat(db, {
    playerId: 1,
    accountId: CLAIMANT,
    authorisedByAccountId: CAPTAIN,
    reason: 'Captain confirmed at registration',
    now: 300,
  })
  assert.deepEqual(repeated, captainClaim, 'a repeated claim returns the original membership')
  assert.equal(rows(), before, 'a repeated claim must not insert a second row')

  console.log('roster claim authorisation tests passed')
} finally {
  database.close()
}
