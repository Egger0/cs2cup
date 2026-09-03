import 'server-only'

const ATTEMPT_LIMIT = 5
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const CLEANUP_BATCH = 64
const FINGERPRINT_PATTERN = /^v1:[0-9a-f]{64}$/

interface AdminLoginStatement {
  first<Type>(): Promise<Type | null>
  run(): Promise<unknown>
}

export interface AdminLoginDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): AdminLoginStatement
  }
}

export interface AdminLoginAdmission {
  bucketStart: number
  fingerprint: string
}

export class AdminLoginAttemptError extends Error {
  readonly code = 'rate_limited'

  constructor() {
    super('rate_limited')
    this.name = 'AdminLoginAttemptError'
  }
}

function exactNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid login attempt time')
  return now
}

function bucketStart(now: number) {
  return Math.floor(now / ATTEMPT_WINDOW_MS) * ATTEMPT_WINDOW_MS
}

export function retryAfterSeconds(inputNow: number) {
  const now = exactNow(inputNow)
  return Math.max(1, Math.ceil((bucketStart(now) + ATTEMPT_WINDOW_MS - now) / 1000))
}

export async function admitAdminLoginAttempt(
  db: AdminLoginDatabase,
  input: { fingerprint: string; now: number },
): Promise<AdminLoginAdmission> {
  const now = exactNow(input.now)
  if (!FINGERPRINT_PATTERN.test(input.fingerprint)) throw new AdminLoginAttemptError()

  const bucket = bucketStart(now)
  await db
    .prepare(
      'DELETE FROM admin_login_attempt WHERE (bucket_start, fingerprint) IN (SELECT bucket_start, fingerprint FROM admin_login_attempt WHERE expires_at <= ? ORDER BY expires_at, bucket_start, fingerprint LIMIT ?)',
    )
    .bind(now, CLEANUP_BATCH)
    .run()
  let admitted: { attempt_count: number } | null
  try {
    admitted = await db
      .prepare(
        'INSERT INTO admin_login_attempt (bucket_start, fingerprint, attempt_count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT (bucket_start, fingerprint) DO UPDATE SET attempt_count = attempt_count + 1 WHERE attempt_count < ? RETURNING attempt_count',
      )
      .bind(bucket, input.fingerprint, bucket + ATTEMPT_WINDOW_MS, ATTEMPT_LIMIT)
      .first<{ attempt_count: number }>()
  } catch (error) {
    if (error instanceof Error && error.message.includes('admin login attempt capacity exceeded')) {
      throw new AdminLoginAttemptError()
    }
    throw error
  }
  if (!admitted) throw new AdminLoginAttemptError()

  return { bucketStart: bucket, fingerprint: input.fingerprint }
}

export async function clearAdminLoginAttempts(
  db: AdminLoginDatabase,
  admission: AdminLoginAdmission,
) {
  if (
    !Number.isSafeInteger(admission.bucketStart) ||
    admission.bucketStart < 0 ||
    !FINGERPRINT_PATTERN.test(admission.fingerprint)
  ) {
    throw new TypeError('Invalid login admission')
  }
  await db
    .prepare('DELETE FROM admin_login_attempt WHERE bucket_start = ? AND fingerprint = ?')
    .bind(admission.bucketStart, admission.fingerprint)
    .run()
}
