import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '@/lib/identity/internal/contracts') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

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
    async batch() {
      throw new Error('unused')
    },
  }
}

const opaque = character => character.repeat(43)
const ASTER = opaque('A')
const HIDDEN = opaque('B')

const database = await createMigratedDatabase()
const db = d1Adapter(database)
const { playerProfileByHandle } = await import('../lib/queries/player-profile.ts')

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap, starts_at)
    VALUES (1, 'cup-a', 'Cup A', 1, '2025', 1, 'finished', 8, '2025-05-01T10:00:00Z'),
           (2, 'cup-b', 'Cup B', 1, '2026', 2, 'running', 8, '2026-05-01T10:00:00Z');
    INSERT INTO team (id, tournament_id, name, tag, captain, contact, status)
    VALUES (1, 1, 'Falcons', 'FLC', 'Cap', 'contact', 'approved'),
           (2, 2, 'Mirage', 'MRG', 'Cap', 'contact', 'approved'),
           (3, 2, 'Rejected', 'REJ', 'Cap', 'contact', 'rejected');
    INSERT INTO player (id, team_id, nickname, is_substitute, sort_order)
    VALUES (1, 1, 'Aster', 0, 1), (2, 2, 'Aster', 1, 1), (3, 3, 'Aster', 0, 1);
  `)
  for (const [id, handle, name, publicHandle] of [
    [ASTER, opaque('a'), '阿斯特', "'aster'"],
    [HIDDEN, opaque('b'), '未公开', 'NULL'],
  ]) {
    database.exec(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at,
         public_handle)
       VALUES ('${id}', '${handle}', '${name}', 'active', 'verified', 1, 1, ${publicHandle})`,
    )
  }
  let seed = 0
  const claim = (playerId, teamId, accountId) =>
    database.exec(
      `INSERT INTO identity_registration_membership
        (id, team_id, account_id, relationship, player_id, grant_reason, granted_at)
       VALUES ('${`c${String(++seed).padStart(42, '0')}`}', ${teamId}, '${accountId}',
               'player', ${playerId}, 'claim', 1)`,
    )
  claim(1, 1, ASTER)
  claim(2, 2, ASTER)
  claim(3, 3, ASTER)

  const profile = await playerProfileByHandle(db, 'aster')
  assert.ok(profile, 'a handle that exists resolves')
  assert.equal(profile.displayName, '阿斯特', 'the display name reads live')
  assert.equal(profile.handle, 'aster')
  assert.deepEqual(
    profile.entries.map(entry => entry.teamTag),
    ['MRG', 'FLC'],
    'approved entries only, newest tournament first',
  )
  assert.equal(profile.entries[0].isSubstitute, true)
  assert.equal(profile.entries[1].isSubstitute, false)

  assert.equal(await playerProfileByHandle(db, 'nobody'), null, 'an unknown handle is not a page')
  assert.equal(await playerProfileByHandle(db, 'ADMIN'), null, 'a malformed handle is rejected')
  assert.equal(
    await playerProfileByHandle(db, '未公开'),
    null,
    'an account without a handle is never published',
  )

  console.log('player profile tests passed')
} finally {
  database.close()
}
