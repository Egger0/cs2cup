import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import type { PasswordPepperSet } from './password-config.ts'
import {
  createRecoveryCode,
  exactRecoveryTime,
  normalizeRecoveryCode,
  RecoveryCodeError,
  RECOVERY_CODE_COUNT,
  recoveryCodeVerifier,
} from './recovery-code-shared.ts'
import { securityEventStatement } from './security-event.ts'
import { hasRecentAuthentication, RECENT_AUTHENTICATION_MS } from './recent-authentication.ts'
import { privateSessionContext } from './session-context.ts'

interface ActiveSetRow {
  id: string | null
  revision: number | null
  created_at: number | null
  activated_at: number | null
  available_count: number
  has_password: number
}

function privateSession(context: AuthenticatedAuthContext) {
  const value = privateSessionContext(context)
  if (!value) throw new RecoveryCodeError('not_authenticated')
  return value
}

async function activeSet(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  const session = privateSession(context)
  return database
    .prepare(
      `SELECT code_set.id, code_set.revision, code_set.created_at, code_set.activated_at,
              (SELECT COUNT(*) FROM identity_recovery_code AS code
               WHERE code.set_id = code_set.id AND code.consumed_at IS NULL) AS available_count,
              EXISTS(SELECT 1 FROM identity_password_credential AS password
                     WHERE password.account_id = account.id
                       AND password.status = 'active') AS has_password
       FROM identity_session AS current
       JOIN identity_account AS account ON account.id = current.account_id
       LEFT JOIN identity_recovery_code_set AS code_set
         ON code_set.account_id = account.id AND code_set.status = 'active'
       WHERE current.id = ? AND current.account_id = ? AND current.token_hash = ?
         AND current.revoked_at IS NULL AND current.security_version = account.security_version
         AND current.idle_expires_at > ? AND current.absolute_expires_at > ?
         AND account.status = 'active' LIMIT 1`,
    )
    .bind(context.session.id, context.account.id, session.tokenHash, now, now)
    .first<ActiveSetRow>()
}

export async function recoveryCodeSummary(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  exactRecoveryTime(now)
  if (context.session.recoveryRestricted) throw new RecoveryCodeError('recovery_restricted')
  const row = await activeSet(database, context, now)
  if (!row) throw new RecoveryCodeError('not_authenticated')
  if (!row.id) return { enabled: false, remaining: 0, createdAt: null } as const
  return {
    enabled: true,
    remaining: Math.max(0, Number(row.available_count) || 0),
    createdAt: row.activated_at,
  } as const
}

export async function generateRecoveryCodes(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  peppers: PasswordPepperSet,
  now = Date.now(),
) {
  exactRecoveryTime(now)
  if (context.session.recoveryRestricted) throw new RecoveryCodeError('recovery_restricted')
  if (!hasRecentAuthentication(context, now)) throw new RecoveryCodeError('reauth_required')
  const session = privateSession(context)
  const previous = await activeSet(database, context, now)
  if (!previous) throw new RecoveryCodeError('not_authenticated')
  if (previous.has_password !== 1) throw new RecoveryCodeError('account_setup_required')

  const setId = createOpaqueToken()
  const displayed = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode)
  const normalized = displayed.map(code => normalizeRecoveryCode(code) as string)
  const verifiers = await Promise.all(
    normalized.map(code => recoveryCodeVerifier(code, peppers.active)),
  )
  const statements = [
    database
      .prepare(
        `INSERT INTO identity_recovery_code_set
          (id, account_id, verifier_key_version, code_count, created_at)
         SELECT ?, account.id, ?, ?, ?
         FROM identity_session AS current
         JOIN identity_account AS account ON account.id = current.account_id
         WHERE current.id = ? AND current.account_id = ? AND current.token_hash = ?
           AND current.revoked_at IS NULL AND current.recovery_restricted = 0
           AND current.authenticated_at >= ?
           AND current.security_version = account.security_version
           AND current.idle_expires_at > ? AND current.absolute_expires_at > ?
           AND account.status = 'active'
           AND EXISTS (
             SELECT 1 FROM identity_password_credential AS password
             WHERE password.account_id = account.id AND password.status = 'active'
           )`,
      )
      .bind(
        setId,
        peppers.active.version,
        RECOVERY_CODE_COUNT,
        now,
        context.session.id,
        context.account.id,
        session.tokenHash,
        now - RECENT_AUTHENTICATION_MS,
        now,
        now,
      ),
    ...verifiers.map((verifier, ordinal) =>
      database
        .prepare(
          `INSERT INTO identity_recovery_code (id, set_id, ordinal, verifier, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(createOpaqueToken(), setId, ordinal, verifier, now),
    ),
  ]
  if (previous.id) {
    statements.push(
      database
        .prepare(
          `UPDATE identity_recovery_code_set
           SET status = 'replaced', closed_at = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND account_id = ? AND status = 'active' AND revision = ?`,
        )
        .bind(now, createOpaqueToken(), previous.id, context.account.id, previous.revision),
    )
  }
  statements.push(
    database
      .prepare(
        `UPDATE identity_recovery_code_set
         SET status = 'active', activated_at = ?, revision = revision + 1, write_nonce = ?
         WHERE id = ? AND account_id = ? AND status = 'building' AND revision = 0`,
      )
      .bind(now, createOpaqueToken(), setId, context.account.id),
    await securityEventStatement(database, {
      eventType: previous.id ? 'account.recovery_codes.rotated' : 'account.recovery_codes.created',
      actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
      targetAccountId: context.account.id,
      resource: { type: 'account', id: context.account.id },
      deduplicationScope: `recovery-code-set:${setId}`,
      details: { codeCount: RECOVERY_CODE_COUNT },
      createdAt: now,
    }),
  )
  try {
    await database.batch(statements)
  } catch {
    throw new RecoveryCodeError('conflict')
  }
  const active = await database
    .prepare(
      `SELECT 1 AS active FROM identity_recovery_code_set
       WHERE id = ? AND account_id = ? AND status = 'active' LIMIT 1`,
    )
    .bind(setId, context.account.id)
    .first<{ active: number }>()
  if (!active) throw new RecoveryCodeError('conflict')
  return Object.freeze(displayed)
}
