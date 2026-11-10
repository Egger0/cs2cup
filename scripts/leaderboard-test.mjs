import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' || specifier === '@/lib/identity/internal/contracts') {
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
        bind: (...values) => ({
          all: async () => ({ results: statement.all(...values) }),
        }),
      }
    },
  }
}

const token = character => character.repeat(43)
const [ALICE, BOB, QUIET] = [token('a'), token('b'), token('c')]
const database = await createMigratedDatabase()
const { loadoutLeaderboard, stardustLeaderboard } = await import('../lib/queries/leaderboard.ts')

try {
  for (const [id, seed, name, handle] of [
    [ALICE, 'x', 'Alice', "'alice'"],
    [BOB, 'y', 'Bob', "'bob'"],
    [QUIET, 'z', 'Quiet', 'NULL'],
  ]) {
    database.exec(
      `INSERT INTO identity_account (id, webauthn_user_handle, display_name, status, verification_state, public_handle)
       VALUES ('${id}', '${token(seed)}', '${name}', 'active', 'verified', ${handle})`,
    )
  }
  database.exec(`
    INSERT INTO stardust_grant (account_id, kind, grant_date, amount, granted_at)
    VALUES ('${ALICE}', 'check_in', '2026-01-01', 10, 1), ('${ALICE}', 'check_in', '2026-01-02', 10, 2),
           ('${BOB}', 'check_in', '2026-01-01', 10, 1), ('${QUIET}', 'check_in', '2026-01-01', 99, 1);
    INSERT INTO game (id, slug, name, loadout_codes) VALUES (1, 'delta-force', 'Delta', 1);
    INSERT INTO loadout_code (id, game_id, account_id, mode, weapon, code, title, status, created_at)
    VALUES (1, 1, '${BOB}', 'operations', 'AK', '${'0'.repeat(21)}', 'Rush', 'pending', 1);
    UPDATE loadout_code SET status = 'approved', reviewed_at = 2 WHERE id = 1;
    INSERT INTO loadout_like (code_id, account_id, created_at)
    VALUES (1, '${ALICE}', 3), (1, '${QUIET}', 3), (1, '${BOB}', 3);
  `)
  const db = d1Adapter(database)
  assert.deepEqual(
    (await stardustLeaderboard(db)).map(row => [row.handle, row.score]),
    [
      ['alice', 20],
      ['bob', 10],
    ],
    'only accounts with a public handle are ranked',
  )
  assert.deepEqual(
    (await loadoutLeaderboard(db)).map(row => [row.handle, row.score]),
    [['bob', 2]],
    'self-likes do not count',
  )
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('leaderboard tests passed')
