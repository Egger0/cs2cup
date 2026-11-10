import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' || specifier === './identity/internal/contracts.ts') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      return {
        bind: (...values) => ({
          first: async () => statement.get(...values) ?? null,
          all: async () => ({ results: statement.all(...values) }),
          run: async () => statement.run(...values),
        }),
      }
    },
  }
}

const token = character => character.repeat(43)
const [ALICE, BOB] = [token('a'), token('b')]
const database = await createMigratedDatabase()
const db = d1Adapter(database)
const { passCheckedIn } = await import('../lib/pass-status.ts')

try {
  for (const [id, seed, name] of [
    [ALICE, 'x', 'Alice'],
    [BOB, 'y', 'Bob'],
  ]) {
    database.exec(
      `INSERT INTO identity_account (id, webauthn_user_handle, display_name, status, verification_state)
       VALUES ('${id}', '${token(seed)}', '${name}', 'active', 'verified')`,
    )
  }
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'live', 'Live', 1, '2026', 1, 'running', 4);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact, status)
    VALUES (1, 1, 'Alpha', 'ALP', 'c', 'c', 'approved');
    INSERT INTO identity_registration_membership
      (id, team_id, account_id, relationship, grant_reason, granted_at)
    VALUES ('${token('m')}', 1, '${ALICE}', 'owner', 'test', 1);
  `)

  assert.equal(await passCheckedIn(db, ALICE, 1), false)
  assert.equal(await passCheckedIn(db, BOB, 1), null, 'non-members cannot read the pass')
  assert.equal(await passCheckedIn(db, ALICE, 9), null)
  database.exec("UPDATE team SET checked_in_at = '2026-05-01T10:00:00.000Z' WHERE id = 1")
  assert.equal(await passCheckedIn(db, ALICE, 1), true)
  database.exec(
    `UPDATE identity_registration_membership SET revoked_at = 2, revoke_reason = 'left', revision = revision + 1, write_nonce = '${token('w')}'
     WHERE account_id = '${ALICE}'`,
  )
  assert.equal(await passCheckedIn(db, ALICE, 1), null, 'revoked members lose access')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('pass status tests passed')
