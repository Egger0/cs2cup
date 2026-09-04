import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import { normalizePasswordForAuthentication } from './password-authentication.ts'
import type { PasswordPepperSet } from './password-config.ts'
import { passwordVerifierFromStorage, verifyPassword } from './password-kdf.ts'

const LOCK_AFTER_FAILURES = 10
const LOCK_MS = 15 * 60 * 1000

export interface PasswordChangeRow {
  credential_id: string
  username: string
  algorithm: string
  parameters_json: string
  salt: ArrayBuffer | Uint8Array
  password_hash: ArrayBuffer | Uint8Array
  pepper_version: number
  secret_version: number
  failed_attempt_count: number
  last_failed_at: number | null
  locked_until: number | null
  last_authenticated_at: number | null
  credential_revision: number
  security_version: number
  display_name: string
  auth_method: string
  recovery_auth_intent_id: string | null
  client_label: string | null
}

export function passwordChangeState(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  tokenHash: string,
  now: number,
) {
  return database
    .prepare(
      `SELECT credential.id AS credential_id, credential.username, credential.algorithm,
              credential.parameters_json, credential.salt, credential.password_hash,
              credential.pepper_version, credential.secret_version,
              credential.failed_attempt_count, credential.last_failed_at,
              credential.locked_until, credential.last_authenticated_at,
              credential.revision AS credential_revision, account.security_version,
              account.display_name, session.auth_method, session.recovery_auth_intent_id,
              CASE WHEN json_type(session.display_metadata_json, '$.clientLabel') = 'text'
                THEN substr(json_extract(session.display_metadata_json, '$.clientLabel'), 1, 100)
                ELSE NULL END AS client_label
       FROM identity_session AS session
       JOIN identity_account AS account ON account.id = session.account_id
       JOIN identity_password_credential AS credential ON credential.account_id = account.id
       WHERE session.id = ? AND session.account_id = ? AND session.token_hash = ?
         AND session.revoked_at IS NULL AND session.security_version = account.security_version
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         AND account.status = 'active' AND credential.status = 'active' LIMIT 1`,
    )
    .bind(context.session.id, context.account.id, tokenHash, now + 3, now + 3)
    .first<PasswordChangeRow>()
}

async function recordFailure(database: IdentityDatabase, row: PasswordChangeRow, now: number) {
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
    .bind(
      count,
      now,
      lockedUntil,
      now,
      createOpaqueToken(),
      row.credential_id,
      row.credential_revision,
    )
    .run()
}

export async function validateCurrentPassword(
  database: IdentityDatabase,
  row: PasswordChangeRow,
  value: unknown,
  peppers: PasswordPepperSet,
  now: number,
) {
  const current = normalizePasswordForAuthentication(value)
  const record = passwordVerifierFromStorage(row)
  const pepper = record ? peppers.byVersion.get(record.pepperVersion) : null
  if (!record || !pepper) return 'configuration_unavailable' as const
  const accepted = current ? await verifyPassword(current, record, pepper) : false
  if (!accepted) {
    await recordFailure(database, row, now)
    return 'invalid_current_password' as const
  }
  if (row.locked_until !== null && row.locked_until > now) return 'temporarily_locked' as const
  return null
}
