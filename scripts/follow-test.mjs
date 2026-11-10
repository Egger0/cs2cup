import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' || specifier === './identity/internal/contracts.ts') {
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
          run: async () => statement.run(...values),
        }),
      }
    },
  }
}

const account = 'a'.repeat(43)
const database = await createMigratedDatabase()
const db = d1Adapter(database)
const { followTournaments, listFollowedTournamentIds, parseFollowIds, unfollowTournament } =
  await import('../lib/follows.ts')

try {
  database.exec(`
    INSERT INTO identity_account (id, webauthn_user_handle, display_name, status, verification_state)
    VALUES ('${account}', '${'x'.repeat(43)}', 'Alice', 'active', 'verified');
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'draft', 'Draft', 1, '2026', 1, 'draft', 4),
           (2, 'live', 'Live', 1, '2026', 2, 'running', 4),
           (3, 'done', 'Done', 1, '2025', 1, 'finished', 4);
  `)
  assert.deepEqual(parseFollowIds([2, 2, 3]), [2, 3])
  assert.equal(parseFollowIds(['2']), null)
  assert.equal(parseFollowIds(Array.from({ length: 101 }, (_, index) => index + 1)), null)

  await followTournaments(db, account, [1, 2, 3, 99], 5)
  assert.deepEqual(
    await listFollowedTournamentIds(db, account),
    [2, 3],
    'drafts and unknown ids are skipped',
  )
  await followTournaments(db, account, [2], 9)
  assert.deepEqual(
    await listFollowedTournamentIds(db, account),
    [2, 3],
    'following twice is a no-op',
  )
  await unfollowTournament(db, account, 2)
  assert.deepEqual(await listFollowedTournamentIds(db, account), [3])
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('follow tests passed')
