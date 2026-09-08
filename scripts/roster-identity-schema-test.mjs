import assert from 'node:assert/strict'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

function expectDatabaseError(database, sql, expectedMessage) {
  assert.throws(
    () => database.exec(sql),
    error => {
      assert.match(error.message, new RegExp(expectedMessage))
      return true
    },
    `database should reject: ${sql}`,
  )
}

const opaque = character => character.repeat(43)
const ALPHA = opaque('A')
const BRAVO = opaque('B')
const CAPTAIN = opaque('C')

const database = await createMigratedDatabase()

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'roster', 'Roster', 1, '2026', 1, 'registration', 4);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES (1, 1, 'Alpha', 'AAA', 'Captain', 'contact');
    INSERT INTO player (id, team_id, nickname, sort_order) VALUES (1, 1, 'Aster', 1);
    INSERT INTO player (id, team_id, nickname, sort_order) VALUES (2, 1, 'Flint', 2);
  `)
  for (const [id, handle, name] of [
    [ALPHA, opaque('a'), 'Alpha'],
    [BRAVO, opaque('b'), 'Bravo'],
    [CAPTAIN, opaque('c'), 'Captain'],
  ]) {
    database.exec(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES ('${id}', '${handle}', '${name}', 'active', 'verified', 1, 1)`,
    )
  }

  const membershipColumns = new Set(
    database
      .prepare('PRAGMA table_info(identity_registration_membership)')
      .all()
      .map(column => column.name),
  )
  assert.equal(membershipColumns.has('player_id'), true, 'a claim must name a roster row')

  const claim = (id, account, relationship, playerId, at = 1, revoked = '') =>
    `INSERT INTO identity_registration_membership
       (id, team_id, account_id, relationship, player_id, grant_reason, granted_at${revoked ? ', revoked_at, revoke_reason' : ''})
     VALUES ('${id}', 1, '${account}', '${relationship}', ${playerId ?? 'NULL'}, 'claim', ${at}${revoked})`

  expectDatabaseError(database, claim(opaque('p'), ALPHA, 'player', null), 'CHECK')
  expectDatabaseError(database, claim(opaque('q'), CAPTAIN, 'owner', 1), 'CHECK')

  database.exec(claim(opaque('r'), ALPHA, 'player', 1, 1, ", 2, 'left the team'"))
  database.exec(claim(opaque('s'), BRAVO, 'player', 1, 3))
  expectDatabaseError(database, claim(opaque('t'), ALPHA, 'player', 1, 4), 'UNIQUE')

  database.exec(claim(opaque('u'), ALPHA, 'player', 2, 5))

  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS live FROM identity_registration_membership
          WHERE relationship = 'player' AND revoked_at IS NULL`,
      )
      .get().live,
    2,
    'each roster row keeps exactly one live claimant',
  )

  database.exec(
    `INSERT INTO identity_registration_membership
       (id, team_id, account_id, relationship, grant_reason, granted_at)
     VALUES ('${opaque('v')}', 1, '${CAPTAIN}', 'owner', 'entry', 1)`,
  )
  expectDatabaseError(
    database,
    `UPDATE identity_registration_membership
       SET expires_at = 9 WHERE id = '${opaque('v')}'`,
    'CHECK|conflict',
  )
  expectDatabaseError(
    database,
    `INSERT INTO identity_registration_membership
       (id, team_id, account_id, relationship, grant_reason, granted_at, revoked_at)
     VALUES ('${opaque('w')}', 1, '${BRAVO}', 'manager', 'entry', 1, 2)`,
    'CHECK',
  )

  for (const index of [
    'identity_registration_active_owner_idx',
    'identity_registration_active_member_idx',
    'identity_registration_account_idx',
    'identity_registration_membership_write_nonce_idx',
    'identity_registration_membership_live_player_idx',
  ]) {
    assert.ok(
      database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?").get(index),
      `the rebuild must keep ${index}`,
    )
  }
  for (const trigger of [
    'identity_registration_membership_update_guard',
    'identity_registration_membership_insert_conflict_guard',
  ]) {
    assert.ok(
      database
        .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'trigger' AND name = ?")
        .get(trigger),
      `the rebuild must keep ${trigger}`,
    )
  }

  console.log('roster identity schema tests passed')
} finally {
  database.close()
}
