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
const [ALICE, BOB, CAROL] = [token('a'), token('b'), token('c')]
const database = await createMigratedDatabase()
const db = d1Adapter(database)
const { followedTeams, setTeamFollow, teamFollowState } = await import('../lib/team-follows.ts')
const inbox = (account, kind) =>
  database
    .prepare('SELECT title, body, href FROM notification WHERE account_id = ? AND kind = ?')
    .all(account, kind)
    .map(row => ({ ...row }))

try {
  for (const [id, seed, name] of [
    [ALICE, 'x', 'Alice'],
    [BOB, 'y', 'Bob'],
    [CAROL, 'z', 'Carol'],
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
    INSERT INTO team (id, tournament_id, name, tag, captain, contact, status)
    VALUES (1, 2, 'Alpha', 'ALP', 'c', 'c', 'approved'), (2, 2, 'Bravo', 'BRV', 'c', 'c', 'approved'),
      (3, 2, 'Pending', 'PEN', 'c', 'c', 'pending'), (4, 1, 'Draft', 'DRF', 'c', 'c', 'approved');
    INSERT INTO match (id, tournament_id, round, slot, round_label, team_a_id, team_b_id)
    VALUES (1, 2, 0, 0, '半决赛', 1, 2);
  `)

  const follow = (accountId, teamId, on = true) =>
    setTeamFollow(db, { accountId, teamId, follow: on }, 10)
  assert.equal(await follow(ALICE, 1), true)
  assert.equal(await follow(ALICE, 1), true, 'following twice is idempotent')
  assert.equal(await follow(BOB, 2), true)
  assert.equal(await follow(ALICE, 3), false, 'pending teams cannot be followed')
  assert.equal(await follow(ALICE, 4), false, 'draft tournaments cannot be followed')
  assert.equal(await follow(ALICE, 99), false)
  assert.deepEqual(await teamFollowState(db, 1, ALICE), { followers: 1, following: true })
  assert.deepEqual(await teamFollowState(db, 1, null), { followers: 1, following: false })
  assert.deepEqual(
    (await followedTeams(db, ALICE)).map(team => [team.tag, team.tournamentSlug]),
    [['ALP', 'live']],
  )

  database.exec('UPDATE match SET score_a = 2, score_b = 1, winner_team_id = 1 WHERE id = 1')
  assert.deepEqual(inbox(ALICE, 'team_result'), [
    {
      title: '关注的队伍有了赛果',
      body: 'Alpha 2 : 1 Bravo · 半决赛',
      href: '/tournaments/live/matches/1',
    },
  ])
  assert.equal(inbox(BOB, 'team_result').length, 1)
  assert.equal(inbox(CAROL, 'team_result').length, 0)
  database.exec('UPDATE match SET score_a = 2, score_b = 0 WHERE id = 1')
  assert.equal(inbox(ALICE, 'team_result').length, 1, 'score corrections do not notify again')

  assert.equal(await follow(ALICE, 1, false), true)
  assert.deepEqual(await teamFollowState(db, 1, ALICE), { followers: 0, following: false })

  const comment = (id, kind, subject, account, at) =>
    database.exec(
      `INSERT INTO comment (id, subject_kind, subject_id, account_id, body, created_at)
       VALUES (${id}, '${kind}', ${subject}, '${account}', 'msg ${id}', ${at})`,
    )
  comment(1, 'post', 1, ALICE, 1000)
  comment(2, 'post', 1, ALICE, 2000)
  comment(3, 'post', 1, BOB, 3000)
  assert.deepEqual(inbox(ALICE, 'comment_reply'), [
    { title: '你参与的讨论有了新留言', body: 'Bob：msg 3', href: '/news/news' },
  ])
  assert.equal(inbox(BOB, 'comment_reply').length, 0, 'authors are not notified of their own')
  comment(4, 'team', 2, CAROL, 4000)
  comment(5, 'team', 2, ALICE, 5000)
  assert.equal(inbox(CAROL, 'comment_reply')[0].href, '/tournaments/live/teams/BRV')
  comment(6, 'match', 1, BOB, 6000)
  comment(7, 'match', 1, CAROL, 6000 + 8 * 86400000)
  assert.equal(inbox(BOB, 'comment_reply').length, 0, 'week-old participants are not notified')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('team follow tests passed')
