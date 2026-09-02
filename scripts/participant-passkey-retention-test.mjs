import assert from 'node:assert/strict'

import { beginAuthenticationCeremony } from '../lib/queries/participant-passkey-challenges.ts'
import { createPasskeyQueryFixture } from './participant-passkey-query-fixture.mjs'

const CLEANUP_BATCH = 64
const now = 1_800_000_000_000
const { database, db } = await createPasskeyQueryFixture()

function expiredCount(table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE expires_at <= ?`).get(now)
    .count
}

async function beginCeremony(marker, challengeMarker) {
  await beginAuthenticationCeremony(db, {
    fingerprint: `v1:${marker.repeat(64)}`,
    ceremonyToken: marker.toUpperCase().repeat(43),
    challenge: challengeMarker.repeat(43),
    previousToken: null,
    now,
  })
}

try {
  database.exec(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 0
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < ${CLEANUP_BATCH}
    )
    INSERT INTO participant_passkey_attempt
      (bucket_start, kind, fingerprint, attempt_count, expires_at)
    SELECT ${now - 1_000}, 'authentication', 'v1:' || printf('%064x', value), 1,
           CASE WHEN value = ${CLEANUP_BATCH} THEN ${now} ELSE ${now - 1} END
    FROM sequence;

    WITH RECURSIVE sequence(value) AS (
      SELECT 0
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < ${CLEANUP_BATCH}
    )
    INSERT INTO participant_webauthn_challenge
      (ceremony_token_hash, challenge, kind, created_at, expires_at)
    SELECT printf('%064x', value), printf('%043d', value), 'authentication',
           ${now - 300_001},
           CASE WHEN value = ${CLEANUP_BATCH} THEN ${now} ELSE ${now - 1} END
    FROM sequence;

    INSERT INTO participant_passkey_attempt
      (bucket_start, kind, fingerprint, attempt_count, expires_at)
    VALUES (${now}, 'claim', 'v1:${'f'.repeat(64)}', 1, ${now + 60_000});

    INSERT INTO participant_webauthn_challenge
      (ceremony_token_hash, challenge, kind, created_at, expires_at)
    VALUES ('${'f'.repeat(64)}', '${'L'.repeat(43)}', 'authentication',
            ${now}, ${now + 60_000});
  `)

  assert.equal(expiredCount('participant_passkey_attempt'), CLEANUP_BATCH + 1)
  assert.equal(expiredCount('participant_webauthn_challenge'), CLEANUP_BATCH + 1)

  await beginCeremony('8', 'A')
  assert.equal(expiredCount('participant_passkey_attempt'), 1)
  assert.equal(expiredCount('participant_webauthn_challenge'), 1)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_passkey_attempt WHERE expires_at = ?')
      .get(now).count,
    1,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_webauthn_challenge WHERE expires_at = ?')
      .get(now).count,
    1,
  )

  await beginCeremony('9', 'B')
  assert.equal(expiredCount('participant_passkey_attempt'), 0)
  assert.equal(expiredCount('participant_webauthn_challenge'), 0)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_passkey_attempt WHERE expires_at > ?')
      .get(now).count,
    3,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_webauthn_challenge WHERE expires_at > ?')
      .get(now).count,
    3,
  )

  console.log('participant passkey retention tests passed')
} finally {
  database.close()
}
