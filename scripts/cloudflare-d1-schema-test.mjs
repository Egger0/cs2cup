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

const database = await createMigratedDatabase()

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES
      (1, 'draft', 'Draft', 1, '2026', 1, 'draft', 4),
      (2, 'live', 'Live', 1, '2026', 2, 'registration', 4);
    INSERT INTO match (id, tournament_id, round, slot, round_label)
    VALUES (1, 1, 0, 0, 'Draft'), (2, 2, 0, 0, 'Live');
    INSERT INTO registration_attempt (fingerprint, tournament_id)
    VALUES ('test', 2), ('test', 2), ('test', 2);
    INSERT INTO guestbook_message (id, name, body, status)
    VALUES
      (1, '公开访客', '公开留言', 'published'),
      (2, '待审核访客', '待审核留言', 'pending');
    INSERT INTO guestbook_message (id, name, body, parent_id, status)
    VALUES
      (3, '公开回复', '公开回复', 1, 'published'),
      (4, '待审核回复', '待审核回复', 1, 'pending');
    UPDATE guestbook_message SET pinned = 1 WHERE id = 1;
    INSERT INTO guestbook_attempt (fingerprint)
    VALUES
      ('guestbook-test'),
      ('guestbook-test'),
      ('guestbook-test'),
      ('guestbook-test'),
      ('guestbook-test');
  `)

  const visibility = database
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM tournament_public) AS tournaments,
        (SELECT COUNT(*) FROM match_public) AS matches,
        (SELECT COUNT(*) FROM guestbook_public) AS messages,
        (
          SELECT id
          FROM guestbook_public
          ORDER BY pinned DESC, created_at DESC, id DESC
          LIMIT 1
        ) AS first_message_id
    `,
    )
    .get()
  assert.equal(visibility.tournaments, 1)
  assert.equal(visibility.matches, 1)
  assert.equal(visibility.messages, 2)
  assert.equal(visibility.first_message_id, 1)

  for (const sql of [
    'UPDATE guestbook_message SET pinned = 1 WHERE id = 3;',
    "INSERT INTO guestbook_message (name, body, parent_id, pinned, status) VALUES ('Guest', 'Pinned reply', 1, 1, 'published');",
  ]) {
    expectDatabaseError(database, sql, '只能置顶主留言')
  }

  for (const sql of [
    "INSERT INTO guestbook_message (name, body, parent_id) VALUES ('Guest', 'Pending parent', 2);",
    "INSERT INTO guestbook_message (name, body, parent_id) VALUES ('Guest', 'Nested reply', 3);",
  ]) {
    expectDatabaseError(database, sql, '只能回复已公开留言')
  }

  database.exec(`
    INSERT INTO guestbook_message (id, name, body, status)
    VALUES (5, 'Delete guest', 'Delete message', 'published');
    INSERT INTO guestbook_message (id, name, body, parent_id, status)
    VALUES (6, 'Delete reply', 'Delete reply', 5, 'published');
    DELETE FROM guestbook_message WHERE id = 5;
  `)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM guestbook_message WHERE id = 6').get().count,
    0,
  )

  expectDatabaseError(
    database,
    "INSERT INTO guestbook_attempt (fingerprint) VALUES ('guestbook-test');",
    '留言太频繁',
  )
  expectDatabaseError(
    database,
    "INSERT INTO registration_attempt (fingerprint, tournament_id) VALUES ('test', 2);",
    '提交太频繁',
  )

  console.log('Cloudflare D1 schema tests passed')
} finally {
  database.close()
}
