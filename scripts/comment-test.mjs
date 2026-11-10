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
const { listComments, parseCommentBody, parseCommentSubject, postComment, removeComment } =
  await import('../lib/comments.ts')

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
  `)

  assert.deepEqual(parseCommentSubject('post', '3'), { kind: 'post', id: 3 })
  assert.equal(parseCommentSubject('team', 1), null)
  assert.equal(parseCommentBody('   '), null)
  assert.equal(parseCommentBody('x'.repeat(301)), null)

  assert.deepEqual(
    await postComment(db, { kind: 'post', id: 1, accountId: ALICE, body: 'hi' }, 10),
    {
      ok: true,
    },
  )
  assert.equal(
    (await postComment(db, { kind: 'post', id: 9, accountId: ALICE, body: 'x' }, 11)).ok,
    false,
  )
  assert.equal(
    (await postComment(db, { kind: 'match', id: 1, accountId: ALICE, body: 'x' }, 12)).ok,
    false,
    'draft tournaments are closed',
  )
  assert.equal(
    (await postComment(db, { kind: 'match', id: 2, accountId: BOB, body: 'gg' }, 13)).ok,
    true,
  )

  for (let index = 0; index < 9; index += 1) {
    await postComment(db, { kind: 'post', id: 1, accountId: BOB, body: `n${index}` }, 20 + index)
  }
  const limited = await postComment(db, { kind: 'post', id: 1, accountId: BOB, body: 'late' }, 40)
  assert.deepEqual(limited, { ok: false, reason: 'limit' })

  const visible = await listComments(db, { kind: 'post', id: 1 }, false)
  assert.equal(visible[0].authorName, 'Alice')
  const aliceComment = visible[0].id
  assert.equal(
    await removeComment(db, { commentId: aliceComment, accountId: BOB, moderator: false }, 50),
    false,
  )
  assert.equal(
    await removeComment(db, { commentId: aliceComment, accountId: BOB, moderator: true }, 50),
    true,
  )
  assert.equal(
    (await listComments(db, { kind: 'post', id: 1 }, false)).some(row => row.id === aliceComment),
    false,
  )
  assert.equal(
    (await listComments(db, { kind: 'post', id: 1 }, true)).find(row => row.id === aliceComment)
      .hidden,
    true,
  )

  database.exec('DELETE FROM post WHERE id = 1')
  assert.equal(
    (await listComments(db, { kind: 'post', id: 1 }, true)).length,
    0,
    'deleting a post removes its comments',
  )
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('comment tests passed')
