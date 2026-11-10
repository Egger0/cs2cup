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
const { parseReaction, parseReactionSubject, setReaction, summarizeReactions } =
  await import('../lib/reactions.ts')

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
    INSERT INTO post (id, slug, title, summary, body) VALUES (1, 'news', 'News', 'S', 'B');
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'draft', 'Draft', 1, '2026', 1, 'draft', 4), (2, 'live', 'Live', 1, '2026', 2, 'running', 4);
    INSERT INTO match (id, tournament_id, round, slot, round_label)
    VALUES (1, 1, 0, 0, 'Draft'), (2, 2, 0, 0, 'Live');
    INSERT INTO team (id, tournament_id, name, tag, captain, contact, status)
    VALUES (1, 2, 'Approved', 'APR', 'c', 'c', 'approved'), (2, 2, 'Pending', 'PEN', 'c', 'c', 'pending');
    INSERT INTO comment (id, subject_kind, subject_id, account_id, body, created_at)
    VALUES (1, 'post', 1, '${ALICE}', 'hi', 1);
  `)

  assert.equal(parseReaction('fire'), 'fire')
  assert.equal(parseReaction('poop'), null)
  assert.deepEqual(parseReactionSubject('comment', '4'), { kind: 'comment', id: 4 })
  assert.equal(parseReactionSubject('player', 1), null)
  assert.equal(parseReactionSubject('post', -1), null)

  const react = (kind, id, accountId, emoji, now = 10) =>
    setReaction(db, { kind, id, accountId, emoji }, now)

  assert.equal(await react('post', 1, ALICE, 'fire'), true)
  assert.equal(await react('post', 1, BOB, 'fire'), true)
  assert.equal(await react('post', 1, BOB, 'heart'), true, 'a second reaction replaces the first')
  assert.deepEqual((await summarizeReactions(db, 'post', [1, 1, 7], BOB))[1], {
    counts: { fire: 1, heart: 1 },
    mine: 'heart',
  })
  assert.deepEqual((await summarizeReactions(db, 'post', [7], BOB))[7], { counts: {}, mine: null })
  assert.equal((await summarizeReactions(db, 'post', [1], null))[1].mine, null)

  assert.equal(await react('post', 1, BOB, null), true)
  assert.deepEqual((await summarizeReactions(db, 'post', [1], BOB))[1], {
    counts: { fire: 1 },
    mine: null,
  })

  assert.equal(await react('post', 9, ALICE, 'fire'), false)
  assert.equal(await react('match', 1, ALICE, 'fire'), false, 'draft tournaments are closed')
  assert.equal(await react('match', 2, ALICE, 'clap'), true)
  assert.equal(await react('team', 2, ALICE, 'clap'), false, 'pending teams are closed')
  assert.equal(await react('team', 1, ALICE, 'clap'), true)
  assert.equal(await react('comment', 1, BOB, 'laugh'), true)
  assert.throws(() => database.exec(`INSERT INTO reaction VALUES ('post', 1, '${BOB}', 'poop', 1)`))

  database.exec('UPDATE comment SET hidden_at = 5 WHERE id = 1')
  assert.deepEqual((await summarizeReactions(db, 'comment', [1], BOB))[1].counts, {})
  assert.equal(await react('comment', 1, BOB, 'laugh'), false, 'hidden comments are closed')

  database.exec(
    'DELETE FROM post WHERE id = 1; DELETE FROM team WHERE id = 1; DELETE FROM match WHERE id = 2',
  )
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM reaction').get().n, 0)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('reaction tests passed')
