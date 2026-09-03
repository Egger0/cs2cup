import 'server-only'

import type { IdentityDatabase } from './contracts.ts'

const WINDOW_MS = 10 * 60 * 1000
const CLEANUP_BATCH = 64
const HASH_PATTERN = /^[0-9a-f]{64}$/

export type AuthAttemptOperation =
  | 'enrollment'
  | 'sign_in'
  | 'recovery'
  | 'identity_link'
  | 'invitation_acceptance'
  | 'sensitive_confirmation'
  | 'legacy_registration_attach'
  | 'passkey_registration'
  | 'passkey_authentication'
  | 'recovery_code'

export type AuthAttemptDimension = 'account' | 'identity' | 'intent' | 'device' | 'network'

export interface AuthAttemptCharge {
  readonly dimension: AuthAttemptDimension
  readonly fingerprintKeyVersion: number
  readonly fingerprintHash: string
  readonly limit: number
}

export class AuthAttemptRateLimitError extends Error {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super('Authentication attempt rate limit reached')
    this.name = 'AuthAttemptRateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function validNow(now: number) {
  return Number.isSafeInteger(now) && now >= 0
}

function startOfWindow(now: number) {
  return Math.floor(now / WINDOW_MS) * WINDOW_MS
}

export function authAttemptRetryAfterSeconds(now: number) {
  if (!validNow(now)) throw new TypeError('Invalid authentication attempt time')
  return Math.max(1, Math.ceil((startOfWindow(now) + WINDOW_MS - now) / 1000))
}

function validCharge(charge: AuthAttemptCharge) {
  return (
    ['account', 'identity', 'intent', 'device', 'network'].includes(charge.dimension) &&
    Number.isSafeInteger(charge.fingerprintKeyVersion) &&
    charge.fingerprintKeyVersion >= 1 &&
    charge.fingerprintKeyVersion <= 255 &&
    HASH_PATTERN.test(charge.fingerprintHash) &&
    Number.isSafeInteger(charge.limit) &&
    charge.limit >= 1 &&
    charge.limit <= 10_000
  )
}

async function cleanupExpired(database: IdentityDatabase, now: number) {
  await database
    .prepare(
      `DELETE FROM identity_auth_attempt_bucket
       WHERE (bucket_start, operation, dimension, fingerprint_key_version, fingerprint_hash) IN (
         SELECT bucket_start, operation, dimension, fingerprint_key_version, fingerprint_hash
         FROM identity_auth_attempt_bucket WHERE expires_at <= ?
         ORDER BY expires_at LIMIT ?
       )`,
    )
    .bind(now, CLEANUP_BATCH)
    .run()
  await database
    .prepare(
      `DELETE FROM identity_auth_attempt_window
       WHERE bucket_start IN (
         SELECT attempt_window.bucket_start FROM identity_auth_attempt_window AS attempt_window
         WHERE attempt_window.expires_at <= ?
           AND NOT EXISTS (
             SELECT 1 FROM identity_auth_attempt_bucket AS attempt_bucket
             WHERE attempt_bucket.bucket_start = attempt_window.bucket_start
           )
         ORDER BY attempt_window.expires_at LIMIT ?
       )`,
    )
    .bind(now, CLEANUP_BATCH)
    .run()
}

async function ensureWindow(database: IdentityDatabase, bucketStart: number) {
  const existing = await database
    .prepare('SELECT bucket_start FROM identity_auth_attempt_window WHERE bucket_start = ?')
    .bind(bucketStart)
    .first<{ bucket_start: number }>()
  if (existing) return
  try {
    await database
      .prepare(
        `INSERT INTO identity_auth_attempt_window
          (bucket_start, distinct_bucket_count, expires_at) VALUES (?, 0, ?)`,
      )
      .bind(bucketStart, bucketStart + WINDOW_MS)
      .run()
  } catch (error) {
    const raced = await database
      .prepare('SELECT bucket_start FROM identity_auth_attempt_window WHERE bucket_start = ?')
      .bind(bucketStart)
      .first<{ bucket_start: number }>()
    if (!raced) throw error
  }
}

function updateAttempt(
  database: IdentityDatabase,
  operation: AuthAttemptOperation,
  charge: AuthAttemptCharge,
  bucketStart: number,
  now: number,
) {
  return database
    .prepare(
      `UPDATE identity_auth_attempt_bucket
       SET attempt_count = attempt_count + 1, last_hit_at = ?,
           blocked_until = CASE WHEN attempt_count + 1 >= ? THEN expires_at ELSE blocked_until END
       WHERE bucket_start = ? AND operation = ? AND dimension = ?
         AND fingerprint_key_version = ? AND fingerprint_hash = ?
         AND attempt_count < ?
       RETURNING attempt_count`,
    )
    .bind(
      now,
      charge.limit,
      bucketStart,
      operation,
      charge.dimension,
      charge.fingerprintKeyVersion,
      charge.fingerprintHash,
      charge.limit,
    )
    .first<{ attempt_count: number }>()
}

async function chargeOne(
  database: IdentityDatabase,
  operation: AuthAttemptOperation,
  charge: AuthAttemptCharge,
  bucketStart: number,
  now: number,
) {
  if (await updateAttempt(database, operation, charge, bucketStart, now)) return
  const existing = await database
    .prepare(
      `SELECT attempt_count FROM identity_auth_attempt_bucket
       WHERE bucket_start = ? AND operation = ? AND dimension = ?
         AND fingerprint_key_version = ? AND fingerprint_hash = ?`,
    )
    .bind(
      bucketStart,
      operation,
      charge.dimension,
      charge.fingerprintKeyVersion,
      charge.fingerprintHash,
    )
    .first<{ attempt_count: number }>()
  if (existing) throw new AuthAttemptRateLimitError(authAttemptRetryAfterSeconds(now))

  try {
    await database
      .prepare(
        `INSERT INTO identity_auth_attempt_bucket
          (bucket_start, operation, dimension, fingerprint_key_version, fingerprint_hash,
           attempt_count, last_hit_at, blocked_until, expires_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        bucketStart,
        operation,
        charge.dimension,
        charge.fingerprintKeyVersion,
        charge.fingerprintHash,
        now,
        charge.limit === 1 ? bucketStart + WINDOW_MS : null,
        bucketStart + WINDOW_MS,
      )
      .run()
  } catch (error) {
    if (await updateAttempt(database, operation, charge, bucketStart, now)) return
    const raced = await database
      .prepare(
        `SELECT 1 AS present FROM identity_auth_attempt_bucket
         WHERE bucket_start = ? AND operation = ? AND dimension = ?
           AND fingerprint_key_version = ? AND fingerprint_hash = ?`,
      )
      .bind(
        bucketStart,
        operation,
        charge.dimension,
        charge.fingerprintKeyVersion,
        charge.fingerprintHash,
      )
      .first<{ present: number }>()
    if (raced) throw new AuthAttemptRateLimitError(authAttemptRetryAfterSeconds(now))
    throw error
  }
}

export async function chargeAuthAttempts(
  database: IdentityDatabase,
  operation: AuthAttemptOperation,
  charges: readonly AuthAttemptCharge[],
  now = Date.now(),
) {
  if (!validNow(now) || !charges.length || charges.length > 4 || !charges.every(validCharge)) {
    throw new TypeError('Invalid authentication attempt charge')
  }
  const bucketStart = startOfWindow(now)
  await cleanupExpired(database, now)
  try {
    await ensureWindow(database, bucketStart)
    for (const charge of charges) {
      await chargeOne(database, operation, charge, bucketStart, now)
    }
  } catch (error) {
    if (error instanceof AuthAttemptRateLimitError) throw error
    if (
      error instanceof Error &&
      /capacity exceeded|state conflict|insert conflict/.test(error.message)
    ) {
      throw new AuthAttemptRateLimitError(authAttemptRetryAfterSeconds(now))
    }
    throw error
  }
}
