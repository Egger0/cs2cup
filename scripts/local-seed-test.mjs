import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const database = await createMigratedDatabase()

try {
  const [seed, readme] = await Promise.all([
    readFile(new URL('../cloudflare/fixtures/local-seed.sql', import.meta.url), 'utf8'),
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
  ])
  database.exec(seed)
  database.exec(seed)

  const expectedCounts = {
    admin_account: 1,
    club_member: 1,
    game: 1,
    guestbook_message: 1,
    match: 3,
    match_map: 1,
    player: 20,
    post: 1,
    team: 4,
    tournament: 1,
  }

  for (const [table, expected] of Object.entries(expectedCounts)) {
    const { count } = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
    assert.equal(count, expected, `${table} fixture count`)
  }

  assert.equal(database.prepare('SELECT slug FROM tournament WHERE id = 1').get().slug, '2026-nlc')

  const rosters = database
    .prepare(
      `
        SELECT
          team_id,
          SUM(CASE WHEN is_substitute = 0 THEN 1 ELSE 0 END) AS starters,
          SUM(CASE WHEN is_substitute = 1 THEN 1 ELSE 0 END) AS substitutes
        FROM player
        GROUP BY team_id
        ORDER BY team_id
      `,
    )
    .all()
  assert.equal(rosters.length, 4)
  for (const roster of rosters) {
    assert.equal(roster.starters, 5, `team ${roster.team_id} starter count`)
    assert.ok(roster.substitutes <= 1, `team ${roster.team_id} substitute count`)
  }

  const documentedLogin = readme.match(/The seed login is `([^`]+)` \/ `([^`]+)`\./)
  assert.ok(documentedLogin, 'README should document the local seed login')
  const [, documentedUsername, documentedPassword] = documentedLogin
  const admin = database
    .prepare('SELECT username, password_salt, password_hash FROM admin_account WHERE id = 1')
    .get()
  assert.equal(admin.username, documentedUsername)
  assert.equal(
    createHash('sha256').update(`${admin.password_salt}\0${documentedPassword}`).digest('hex'),
    admin.password_hash,
  )

  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')

  console.log('local seed tests passed')
} finally {
  database.close()
}
