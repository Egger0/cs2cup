import assert from 'node:assert/strict'

import {
  AdminLoginAttemptError,
  admitAdminLoginAttempt,
  clearAdminLoginAttempts,
  retryAfterSeconds,
} from '../lib/queries/admin-login-attempts.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const WINDOW_MS = 10 * 60 * 1000
const CAPACITY = 2048
const now = 1_800_000_000_000
const fingerprint = `v1:${'a'.repeat(64)}`
const otherFingerprint = `v1:${'b'.repeat(64)}`
const isRateLimited = error =>
  error instanceof AdminLoginAttemptError && error.code === 'rate_limited'

function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      let bindings = []
      const prepared = {
        bind(...values) {
          bindings = values
          return prepared
        },
        async first() {
          return statement.get(...bindings) ?? null
        },
        async run() {
          return statement.run(...bindings)
        },
      }
      return prepared
    },
  }
}

function expectDatabaseError(database, sql) {
  assert.throws(() => database.exec(sql))
}

assert.equal(retryAfterSeconds(0), 600)
assert.equal(retryAfterSeconds(300_000), 300)
assert.equal(retryAfterSeconds(599_999), 1)
assert.equal(retryAfterSeconds(600_000), 600)

const database = await createMigratedDatabase()
const db = d1Adapter(database)

try {
  let admission
  for (let attempt = 0; attempt < 5; attempt += 1) {
    admission = await admitAdminLoginAttempt(db, { fingerprint, now })
    assert.deepEqual(admission, { bucketStart: now, fingerprint })
  }
  await assert.rejects(() => admitAdminLoginAttempt(db, { fingerprint, now }), isRateLimited)
  assert.deepEqual(
    {
      ...database
        .prepare(
          'SELECT bucket_start, fingerprint, attempt_count, expires_at FROM admin_login_attempt',
        )
        .get(),
    },
    {
      bucket_start: now,
      fingerprint,
      attempt_count: 5,
      expires_at: now + WINDOW_MS,
    },
  )

  const nextNow = now + WINDOW_MS
  const nextAdmission = await admitAdminLoginAttempt(db, { fingerprint, now: nextNow })
  await admitAdminLoginAttempt(db, { fingerprint: otherFingerprint, now: nextNow })
  assert.deepEqual(nextAdmission, { bucketStart: nextNow, fingerprint })
  await clearAdminLoginAttempts(db, admission)
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM admin_login_attempt WHERE bucket_start = ? AND fingerprint = ?',
      )
      .get(nextNow, fingerprint).count,
    1,
    'clearing an older admission must not delete a new window',
  )
  await clearAdminLoginAttempts(db, nextAdmission)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM admin_login_attempt WHERE fingerprint = ?')
      .get(fingerprint).count,
    0,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM admin_login_attempt WHERE fingerprint = ?')
      .get(otherFingerprint).count,
    1,
    'successful login cleanup must stay fingerprint-scoped',
  )

  const schemaBucket = now + 10 * WINDOW_MS
  for (const values of [
    [schemaBucket, 'invalid', 1, schemaBucket + WINDOW_MS],
    [schemaBucket, `v1:${'c'.repeat(64)}`, 0, schemaBucket + WINDOW_MS],
    [schemaBucket, `v1:${'d'.repeat(64)}`, 6, schemaBucket + WINDOW_MS],
    [schemaBucket, `v1:${'e'.repeat(64)}`, 1, schemaBucket],
    [schemaBucket, `v1:${'f'.repeat(64)}`, 1, schemaBucket + WINDOW_MS + 1],
  ]) {
    expectDatabaseError(
      database,
      `INSERT INTO admin_login_attempt
        (bucket_start, fingerprint, attempt_count, expires_at)
       VALUES (${values[0]}, '${values[1]}', ${values[2]}, ${values[3]})`,
    )
  }

  const capacityBucket = now + 20 * WINDOW_MS
  database.exec(`
    WITH RECURSIVE sequence(value) AS
      (SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < ${CAPACITY - 1})
    INSERT INTO admin_login_attempt (bucket_start, fingerprint, attempt_count, expires_at)
    SELECT ${capacityBucket}, 'v1:' || printf('%064x', value), 1,
           ${capacityBucket + WINDOW_MS}
    FROM sequence;
  `)
  await assert.rejects(
    () =>
      admitAdminLoginAttempt(db, {
        fingerprint: `v1:${'f'.repeat(64)}`,
        now: capacityBucket,
      }),
    isRateLimited,
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM admin_login_attempt').get().count,
    CAPACITY,
  )
  const existingFingerprint = `v1:${'0'.repeat(64)}`
  assert.deepEqual(
    await admitAdminLoginAttempt(db, { fingerprint: existingFingerprint, now: capacityBucket }),
    { bucketStart: capacityBucket, fingerprint: existingFingerprint },
  )
  assert.equal(
    database
      .prepare('SELECT attempt_count FROM admin_login_attempt WHERE fingerprint = ?')
      .get(existingFingerprint).attempt_count,
    2,
  )
  expectDatabaseError(
    database,
    `UPDATE admin_login_attempt SET attempt_count = attempt_count + 2
     WHERE bucket_start = ${capacityBucket} AND fingerprint = '${existingFingerprint}'`,
  )

  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('admin login attempt query and schema tests passed')
} finally {
  database.close()
}
