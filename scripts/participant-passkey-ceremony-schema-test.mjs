import assert from 'node:assert/strict'

import { expectDatabaseError, insertChallenge } from './participant-passkey-schema-fixture.mjs'

export function testParticipantPasskeyCeremonySchema(database) {
  const claimHash = '1'.repeat(64)
  const authHash = '2'.repeat(64)
  insertChallenge(database)
  insertChallenge(database, {
    tokenHash: authHash,
    challenge: 'R'.repeat(43),
    kind: 'authentication',
    principal: null,
    userHandle: null,
    teamId: null,
    managementHash: null,
  })

  expectDatabaseError(
    () => insertChallenge(database, { challenge: 'S'.repeat(43) }),
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    () => insertChallenge(database, { tokenHash: '3'.repeat(64) }),
    'UNIQUE constraint failed',
  )
  for (const invalid of [
    { tokenHash: '3'.repeat(64), challenge: 'S'.repeat(43), userHandle: null },
    {
      tokenHash: '4'.repeat(64),
      challenge: 'T'.repeat(43),
      kind: 'authentication',
      userHandle: null,
      teamId: null,
      managementHash: null,
    },
    { tokenHash: '5'.repeat(64), challenge: 'U'.repeat(43), expiresAt: 610_001 },
  ]) {
    expectDatabaseError(() => insertChallenge(database, invalid), 'CHECK constraint failed')
  }
  expectDatabaseError(
    () =>
      insertChallenge(database, {
        tokenHash: '6'.repeat(64),
        challenge: 'V'.repeat(43),
        teamId: 999,
      }),
    'FOREIGN KEY constraint failed',
  )
  expectDatabaseError(
    () =>
      insertChallenge(database, {
        tokenHash: '7'.repeat(64),
        challenge: 'W'.repeat(43),
        kind: 'authentication',
        principal: null,
        userHandle: null,
        teamId: null,
        managementHash: null,
        consumeNonce: 'X'.repeat(43),
        consumedAt: 20_000,
      }),
    'passkey challenge must start fresh',
  )

  const fresh = database.prepare(`
    SELECT COUNT(*) AS count FROM participant_webauthn_challenge
    WHERE ceremony_token_hash = ? AND consumed_at IS NULL AND expires_at > ?
  `)
  assert.equal(fresh.get(claimHash, 309_999).count, 1)
  assert.equal(fresh.get(claimHash, 310_000).count, 0)
  const consume = database.prepare(`
    UPDATE participant_webauthn_challenge
    SET consume_nonce = ?, consumed_at = ?
    WHERE ceremony_token_hash = ? AND consumed_at IS NULL AND expires_at > ?
  `)
  const nonce = 'Y'.repeat(43)
  assert.equal(consume.run(nonce, 20_000, claimHash, 20_000).changes, 1)
  assert.equal(consume.run(nonce, 20_000, claimHash, 20_000).changes, 0)
  expectDatabaseError(
    () =>
      database
        .prepare(
          'UPDATE participant_webauthn_challenge SET consume_nonce = ?, consumed_at = ? WHERE ceremony_token_hash = ?',
        )
        .run('Z'.repeat(43), 21_000, claimHash),
    'passkey challenge already consumed or immutable',
  )
  expectDatabaseError(
    () => consume.run(nonce, 20_000, authHash, 20_000),
    'UNIQUE constraint failed',
  )

  const bucket = 1_000_000
  const fingerprint = `v1:${'f'.repeat(64)}`
  const attempt = database.prepare(`
    INSERT INTO participant_passkey_attempt
      (bucket_start, kind, fingerprint, attempt_count, expires_at)
    VALUES (?, 'authentication', ?, 1, ?)
    ON CONFLICT (bucket_start, kind, fingerprint)
    DO UPDATE SET attempt_count = participant_passkey_attempt.attempt_count + 1
  `)
  for (let count = 0; count < 5; count += 1) {
    attempt.run(bucket, fingerprint, bucket + 300_000)
  }
  assert.equal(
    database.prepare('SELECT attempt_count FROM participant_passkey_attempt').get().attempt_count,
    5,
  )
  expectDatabaseError(
    () => attempt.run(bucket, fingerprint, bucket + 300_000),
    'CHECK constraint failed',
  )
  expectDatabaseError(
    () =>
      database
        .prepare(
          `
            UPDATE participant_passkey_attempt
            SET attempt_count = attempt_count + 2
            WHERE bucket_start = ? AND kind = ? AND fingerprint = ?
          `,
        )
        .run(bucket, 'authentication', fingerprint),
    'passkey attempt state conflict',
  )
  expectDatabaseError(
    () =>
      database.exec(`
        INSERT INTO participant_passkey_attempt (bucket_start, kind, fingerprint, expires_at)
        VALUES (${bucket}, 'claim', 'v1:${'e'.repeat(64)}', ${bucket + 3_600_001});
      `),
    'CHECK constraint failed',
  )

  const capacityBucket = 2_000_000
  database.exec(`
    WITH RECURSIVE sequence(value) AS
      (SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 2047)
    INSERT INTO participant_passkey_attempt (bucket_start, kind, fingerprint, expires_at)
    SELECT ${capacityBucket}, 'authentication', 'v1:' || printf('%064x', value),
           ${capacityBucket + 300_000}
    FROM sequence;
  `)
  expectDatabaseError(
    () =>
      database.exec(`
        INSERT INTO participant_passkey_attempt (bucket_start, kind, fingerprint, expires_at)
        VALUES (${capacityBucket}, 'claim', 'v1:${'f'.repeat(63)}e',
                ${capacityBucket + 300_000});
      `),
    'passkey options capacity exceeded',
  )

  database.exec('DELETE FROM team WHERE id = 10')
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_webauthn_challenge').get().count,
    1,
  )
}
