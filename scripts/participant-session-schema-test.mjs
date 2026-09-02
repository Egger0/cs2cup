import assert from 'node:assert/strict'

import { expectDatabaseError, passkeyFixture } from './participant-passkey-schema-fixture.mjs'

export function testParticipantSessionSchema(database) {
  const { alpha, bravo, alphaCredential, bravoCredential } = passkeyFixture
  const insertSession = database.prepare(`
    INSERT INTO participant_session
      (token_hash, principal_id, credential_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `)
  const sessionHash = '8'.repeat(64)
  insertSession.run(sessionHash, alpha, alphaCredential, 100_000, 28_900_000)
  expectDatabaseError(
    () => insertSession.run(sessionHash, alpha, alphaCredential, 100_000, 28_900_000),
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    () => insertSession.run('9'.repeat(64), bravo, alphaCredential, 100_000, 28_900_000),
    'FOREIGN KEY constraint failed',
  )
  expectDatabaseError(
    () => insertSession.run('a'.repeat(64), alpha, 'missing', 100_000, 28_900_000),
    'FOREIGN KEY constraint failed',
  )
  expectDatabaseError(
    () => insertSession.run('b'.repeat(64), bravo, bravoCredential, 100_000, 2_592_100_001),
    'CHECK constraint failed',
  )
  expectDatabaseError(
    () =>
      database
        .prepare('UPDATE participant_session SET expires_at = ? WHERE token_hash = ?')
        .run(29_000_000, sessionHash),
    'participant session is immutable',
  )

  database
    .prepare('DELETE FROM participant_passkey_credential WHERE credential_id = ?')
    .run(alphaCredential)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
    0,
    'deleting a credential must revoke its sessions',
  )

  const privateRelations = [
    'participant_passkey_credential',
    'participant_webauthn_challenge',
    'participant_passkey_attempt',
    'participant_session',
  ]
  const publicViews = database
    .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'view' AND name LIKE '%_public'")
    .all()
  assert.ok(publicViews.length > 0)
  for (const view of publicViews) {
    for (const relation of privateRelations) {
      assert.doesNotMatch(view.sql.toLowerCase(), new RegExp(`\\b${relation}\\b`))
    }
  }

  const challengeColumns = new Set(
    database
      .prepare('PRAGMA table_info(participant_webauthn_challenge)')
      .all()
      .map(column => column.name),
  )
  const sessionColumns = new Set(
    database
      .prepare('PRAGMA table_info(participant_session)')
      .all()
      .map(column => column.name),
  )
  assert.equal(challengeColumns.has('ceremony_token'), false)
  assert.equal(challengeColumns.has('management_token'), false)
  assert.equal(sessionColumns.has('token'), false)
}
