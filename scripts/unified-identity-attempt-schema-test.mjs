import assert from 'node:assert/strict'

import {
  createUnifiedIdentitySchemaFixture,
  identityKeyHash,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  const bucketStart = Math.floor(Date.now() / 600000) * 600000
  const expiresAt = bucketStart + 600000
  const hitAt = Math.min(Date.now(), expiresAt - 1)
  execute(
    `INSERT INTO identity_auth_attempt_window (bucket_start, expires_at)
     VALUES (?, ?)`,
    [bucketStart, expiresAt],
  )
  const chargeAttempt = (fingerprint, lastHitAt = hitAt) => {
    const update = execute(
      `UPDATE identity_auth_attempt_bucket
       SET attempt_count = attempt_count + 1, last_hit_at = ?
       WHERE bucket_start = ? AND operation = 'sign_in' AND dimension = 'device'
         AND fingerprint_key_version = 1 AND fingerprint_hash = ?`,
      [lastHitAt, bucketStart, fingerprint],
    )
    if (update.changes) return update
    return execute(
      `INSERT INTO identity_auth_attempt_bucket
        (bucket_start, operation, dimension, fingerprint_key_version, fingerprint_hash,
         attempt_count, last_hit_at, expires_at)
       VALUES (?, 'sign_in', 'device', 1, ?, 1, ?, ?)`,
      [bucketStart, fingerprint, lastHitAt, expiresAt],
    )
  }
  const firstFingerprint = identityKeyHash('rate', 'device', 'first')
  chargeAttempt(firstFingerprint)
  chargeAttempt(firstFingerprint)
  const chargedAttempt = database
    .prepare(
      `SELECT attempt_count, last_hit_at
       FROM identity_auth_attempt_bucket
       WHERE bucket_start = ? AND fingerprint_hash = ?`,
    )
    .get(bucketStart, firstFingerprint)
  assert.equal(chargedAttempt.attempt_count, 2)
  assert.equal(chargedAttempt.last_hit_at, hitAt)
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_auth_attempt_bucket
          (bucket_start, operation, dimension, fingerprint_key_version, fingerprint_hash,
           attempt_count, last_hit_at, expires_at)
         VALUES (?, 'sign_in', 'device', 1, ?, 1, ?, ?)`,
        [bucketStart, firstFingerprint, hitAt, expiresAt],
      ),
    /insert conflict/,
  )
  assert.equal(
    database
      .prepare(
        `SELECT distinct_bucket_count
         FROM identity_auth_attempt_window WHERE bucket_start = ?`,
      )
      .get(bucketStart).distinct_bucket_count,
    1,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_auth_attempt_bucket
         SET attempt_count = attempt_count + 2
         WHERE bucket_start = ? AND fingerprint_hash = ?`,
        [bucketStart, firstFingerprint],
      ),
    /state conflict/,
  )
  expectError(
    () =>
      execute(
        `DELETE FROM identity_auth_attempt_bucket
         WHERE bucket_start = ? AND fingerprint_hash = ?`,
        [bucketStart, firstFingerprint],
      ),
    /has not expired/,
  )
  expectError(
    () => execute('DELETE FROM identity_auth_attempt_window WHERE bucket_start = ?', [bucketStart]),
    /has not expired|FOREIGN KEY/,
  )

  for (let index = 1; index < 2048; index += 1) {
    chargeAttempt(identityKeyHash('rate', 'device', `capacity-${index}`))
  }
  assert.equal(
    database
      .prepare(
        `SELECT distinct_bucket_count
         FROM identity_auth_attempt_window WHERE bucket_start = ?`,
      )
      .get(bucketStart).distinct_bucket_count,
    2048,
  )
  chargeAttempt(firstFingerprint)
  assert.equal(
    database
      .prepare(
        `SELECT attempt_count
         FROM identity_auth_attempt_bucket
         WHERE bucket_start = ? AND fingerprint_hash = ?`,
      )
      .get(bucketStart, firstFingerprint).attempt_count,
    3,
  )
  expectError(() => chargeAttempt(identityKeyHash('rate', 'device', 'capacity-overflow')))

  console.log('unified identity attempt schema tests passed')
} finally {
  database.close()
}
