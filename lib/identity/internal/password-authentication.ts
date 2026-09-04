import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { IdentityDatabase } from './contracts.ts'
import type { PasswordPepperSet } from './password-config.ts'
import {
  PASSWORD_KDF_ALGORITHM,
  PASSWORD_KDF_ITERATIONS,
  PASSWORD_KDF_VERSION,
  passwordVerifierFromStorage,
  verifyPassword,
  type PasswordPepper,
} from './password-kdf.ts'
import { createSessionDraft, prepareSessionInsert } from './session-draft.ts'
import { securityEventStatement } from './security-event.ts'
import { normalizeUsername } from './username-policy.ts'

const MAX_AUTH_PASSWORD_CODE_UNITS = 512
const LOCK_AFTER_FAILURES = 10
const LOCK_MS = 15 * 60 * 1000
const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA'
const DUMMY_VERIFIER = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

interface PasswordCredentialRow {
  id: string
  account_id: string
  algorithm: string
  parameters_json: string
  salt: ArrayBuffer | Uint8Array
  password_hash: ArrayBuffer | Uint8Array
  pepper_version: number
  status: 'active' | 'revoked'
  failed_attempt_count: number
  last_failed_at: number | null
  locked_until: number | null
  last_authenticated_at: number | null
  revision: number
}

export type PasswordAuthenticationResult =
  | {
      ok: true
      token: string
      absoluteExpiresAt: number
      accountId: string
      sessionId: string
    }
  | { ok: false; reason: 'invalid' | 'temporarily_locked' | 'configuration_unavailable' }

export interface PasswordSessionReplacement {
  readonly unifiedTokenHash?: string | null
  readonly legacyAdminTokenHash?: string | null
  readonly legacyParticipantTokenHash?: string | null
}

export function normalizePasswordForAuthentication(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_AUTH_PASSWORD_CODE_UNITS)
    return null
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null
  }
  return value.normalize('NFC')
}

function dummyRecord(activePepperVersion: number) {
  return {
    algorithm: PASSWORD_KDF_ALGORITHM,
    algorithmVersion: PASSWORD_KDF_VERSION,
    iterations: PASSWORD_KDF_ITERATIONS,
    salt: DUMMY_SALT,
    verifier: DUMMY_VERIFIER,
    pepperVersion: activePepperVersion,
  } as const
}

async function credentialForUsername(database: IdentityDatabase, username: string | null) {
  if (!username) return null
  return database
    .prepare(
      `SELECT id, account_id, algorithm, parameters_json, salt, password_hash, pepper_version,
              status, failed_attempt_count, last_failed_at, locked_until,
              last_authenticated_at, revision
       FROM identity_password_credential WHERE username = ? LIMIT 1`,
    )
    .bind(username)
    .first<PasswordCredentialRow>()
}

function validCredentialState(row: PasswordCredentialRow) {
  return (
    /^[A-Za-z0-9_-]{43}$/.test(row.id) &&
    /^[A-Za-z0-9_-]{43}$/.test(row.account_id) &&
    ['active', 'revoked'].includes(row.status) &&
    Number.isSafeInteger(row.failed_attempt_count) &&
    row.failed_attempt_count >= 0 &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 0
  )
}

function passwordPepperForRow(peppers: PasswordPepperSet, version: number): PasswordPepper | null {
  return peppers.byVersion.get(version) ?? null
}

async function recordFailure(database: IdentityDatabase, row: PasswordCredentialRow, now: number) {
  const count = Math.min(10_000, row.failed_attempt_count + 1)
  const lockedUntil =
    count >= LOCK_AFTER_FAILURES ? Math.max(row.locked_until ?? 0, now + LOCK_MS) : row.locked_until
  await database
    .prepare(
      `UPDATE identity_password_credential
       SET failed_attempt_count = ?, last_failed_at = ?, locked_until = ?, updated_at = ?,
           revision = revision + 1, write_nonce = ?
       WHERE id = ? AND revision = ? AND status = 'active' AND failed_attempt_count < 10000`,
    )
    .bind(count, now, lockedUntil, now, createOpaqueToken(), row.id, row.revision)
    .run()
}

function passwordSuccessStatement(
  database: IdentityDatabase,
  row: PasswordCredentialRow,
  authenticatedAt: number,
  verificationNonce: string,
) {
  return database
    .prepare(
      `UPDATE identity_password_credential
       SET failed_attempt_count = 0, last_failed_at = NULL, locked_until = NULL,
           last_authenticated_at = ?, updated_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND revision = ? AND status = 'active'
         AND (last_authenticated_at IS NULL OR last_authenticated_at < ?)
       RETURNING id`,
    )
    .bind(
      authenticatedAt,
      authenticatedAt,
      verificationNonce,
      row.id,
      row.revision,
      authenticatedAt,
    )
}

function validOptionalHash(value: string | null | undefined) {
  return value === undefined || value === null || /^[0-9a-f]{64}$/.test(value)
}

function replacementStatements(
  database: IdentityDatabase,
  replacement: PasswordSessionReplacement,
  now: number,
) {
  if (
    !validOptionalHash(replacement.unifiedTokenHash) ||
    !validOptionalHash(replacement.legacyAdminTokenHash) ||
    !validOptionalHash(replacement.legacyParticipantTokenHash)
  ) {
    throw new TypeError('Invalid session replacement input')
  }
  const statements = []
  if (replacement.unifiedTokenHash) {
    statements.push(
      database
        .prepare(
          `UPDATE identity_session
           SET revoked_at = ?, revoke_reason = 'replaced_by_sign_in',
               revision = revision + 1, write_nonce = ?
           WHERE token_hash = ? AND revoked_at IS NULL`,
        )
        .bind(now, createOpaqueToken(), replacement.unifiedTokenHash),
    )
  }
  if (replacement.legacyAdminTokenHash) {
    statements.push(
      database
        .prepare('DELETE FROM admin_session WHERE token_hash = ?')
        .bind(replacement.legacyAdminTokenHash),
    )
  }
  if (replacement.legacyParticipantTokenHash) {
    statements.push(
      database
        .prepare('DELETE FROM participant_session WHERE token_hash = ?')
        .bind(replacement.legacyParticipantTokenHash),
    )
  }
  return statements
}

export async function authenticatePassword(
  database: IdentityDatabase,
  input: { username: unknown; password: unknown },
  peppers: PasswordPepperSet,
  now = Date.now(),
  replacement: PasswordSessionReplacement = {},
  clientLabel?: string,
): Promise<PasswordAuthenticationResult> {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid authentication time')
  const username = normalizeUsername(input.username)
  const password = normalizePasswordForAuthentication(input.password)
  const row = await credentialForUsername(database, username)
  const storedRecord = row && validCredentialState(row) ? passwordVerifierFromStorage(row) : null
  const pepper = storedRecord ? passwordPepperForRow(peppers, storedRecord.pepperVersion) : null
  const verificationRecord =
    storedRecord && pepper ? storedRecord : dummyRecord(peppers.active.version)
  const verificationPepper = pepper ?? peppers.active
  const accepted = await verifyPassword(password ?? '', verificationRecord, verificationPepper)

  if (!row || !validCredentialState(row) || row.status !== 'active' || !accepted || !password) {
    if (row && validCredentialState(row) && row.status === 'active') {
      await recordFailure(database, row, now)
    }
    return {
      ok: false,
      reason: row && storedRecord && !pepper ? 'configuration_unavailable' : 'invalid',
    }
  }
  if (row.locked_until !== null && row.locked_until > now) {
    return { ok: false, reason: 'temporarily_locked' }
  }

  const authenticatedAt = Math.max(now, (row.last_authenticated_at ?? -1) + 1)
  const verificationNonce = createOpaqueToken()
  const draft = await createSessionDraft({
    accountId: row.account_id,
    authentication: {
      method: 'password',
      passwordCredentialId: row.id,
      verificationNonce,
    },
    displayMetadata: clientLabel ? { clientLabel } : undefined,
    now: authenticatedAt,
  })
  await database.batch([
    passwordSuccessStatement(database, row, authenticatedAt, verificationNonce),
    prepareSessionInsert(database, draft),
    await securityEventStatement(database, {
      eventType: 'account.signed_in',
      actor: { type: 'account', accountId: row.account_id, sessionId: draft.record.id },
      targetAccountId: row.account_id,
      resource: { type: 'platform' },
      correlationId: draft.record.id,
      deduplicationScope: `password-sign-in:${draft.record.id}`,
      details: { method: 'password' },
      createdAt: authenticatedAt,
    }),
    ...replacementStatements(database, replacement, authenticatedAt),
  ])
  return {
    ok: true,
    token: draft.token,
    absoluteExpiresAt: draft.record.absoluteExpiresAt,
    accountId: row.account_id,
    sessionId: draft.record.id,
  }
}
