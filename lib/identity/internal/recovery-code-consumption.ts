import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { IdentityDatabase, IdentityStatement } from './contracts.ts'
import type { PasswordPepperSet } from './password-config.ts'
import {
  exactRecoveryTime,
  normalizeRecoveryCode,
  RecoveryCodeError,
  RECOVERY_INTENT_TTL_MS,
  recoveryCodeVerifier,
} from './recovery-code-shared.ts'
import { createSessionDraft, prepareSessionInsert } from './session-draft.ts'
import { securityEventStatement } from './security-event.ts'
import { normalizeUsername } from './username-policy.ts'

interface RecoveryTargetRow {
  account_id: string
  set_id: string
  verifier_key_version: number
}

interface RecoveryCodeRow {
  id: string
  revision: number
}

export interface RecoverySessionReplacement {
  readonly unifiedTokenHash?: string | null
  readonly legacyAdminTokenHash?: string | null
  readonly legacyParticipantTokenHash?: string | null
}

const TOKEN_HASH = /^[0-9a-f]{64}$/

function replacementStatements(
  database: IdentityDatabase,
  replacement: RecoverySessionReplacement,
  now: number,
) {
  const hashes = [
    replacement.unifiedTokenHash,
    replacement.legacyAdminTokenHash,
    replacement.legacyParticipantTokenHash,
  ]
  if (hashes.some(hash => hash !== undefined && hash !== null && !TOKEN_HASH.test(hash))) {
    throw new TypeError('Invalid recovery session replacement')
  }
  const statements: IdentityStatement[] = []
  if (replacement.unifiedTokenHash) {
    statements.push(
      database
        .prepare(
          `UPDATE identity_session
           SET revoked_at = ?, revoke_reason = 'replaced_by_recovery_sign_in',
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

function recoveryTarget(database: IdentityDatabase, username: string) {
  return database
    .prepare(
      `SELECT account.id AS account_id, code_set.id AS set_id, code_set.verifier_key_version
       FROM identity_password_credential AS credential
       JOIN identity_account AS account ON account.id = credential.account_id
       JOIN identity_recovery_code_set AS code_set ON code_set.account_id = account.id
       WHERE credential.username = ? AND credential.status = 'active'
         AND account.status = 'active' AND code_set.status = 'active' LIMIT 1`,
    )
    .bind(username)
    .first<RecoveryTargetRow>()
}

export async function consumeRecoveryCode(
  database: IdentityDatabase,
  input: { username: unknown; code: unknown; clientLabel?: string },
  peppers: PasswordPepperSet,
  now = Date.now(),
  replacement: RecoverySessionReplacement = {},
) {
  exactRecoveryTime(now)
  const username = normalizeUsername(input.username)
  const normalizedCode = normalizeRecoveryCode(input.code)
  if (!username || !normalizedCode) throw new RecoveryCodeError('invalid_input')
  const target = await recoveryTarget(database, username)
  const pepper = target ? peppers.byVersion.get(target.verifier_key_version) : peppers.active
  const verifier = await recoveryCodeVerifier(normalizedCode, pepper ?? peppers.active)
  if (!target || !pepper) throw new RecoveryCodeError('invalid_code')
  const code = await database
    .prepare(
      `SELECT id, revision FROM identity_recovery_code
       WHERE set_id = ? AND verifier = ? AND consumed_at IS NULL LIMIT 1`,
    )
    .bind(target.set_id, verifier)
    .first<RecoveryCodeRow>()
  if (!code) throw new RecoveryCodeError('invalid_code')

  const intentId = createOpaqueToken()
  const consumeNonce = createOpaqueToken()
  const draft = await createSessionDraft({
    accountId: target.account_id,
    authentication: {
      method: 'recovery_code',
      recovery: { authIntentId: intentId, recoveryCodeId: code.id },
    },
    displayMetadata: {
      recovery: true,
      ...(input.clientLabel ? { clientLabel: input.clientLabel } : {}),
    },
    now,
  })
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_auth_intent
            (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
             idempotency_key, max_attempts, created_at, expires_at)
           VALUES (?, ?, 'recovery', ?, 'account_security', ?, ?, 1, ?, ?)`,
        )
        .bind(
          intentId,
          await hashOpaqueToken(createOpaqueToken()),
          target.account_id,
          createOpaqueToken(),
          await hashOpaqueToken(createOpaqueToken()),
          now,
          now + RECOVERY_INTENT_TTL_MS,
        ),
      database
        .prepare(
          `UPDATE identity_recovery_code
           SET consumed_at = ?, consumed_auth_intent_id = ?, consume_nonce = ?,
               revision = revision + 1, write_nonce = ?
           WHERE id = ? AND set_id = ? AND verifier = ? AND consumed_at IS NULL
             AND revision = ?`,
        )
        .bind(
          now,
          intentId,
          consumeNonce,
          createOpaqueToken(),
          code.id,
          target.set_id,
          verifier,
          code.revision,
        ),
      database
        .prepare(
          `UPDATE identity_auth_intent
           SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'recovery_code',
               completion_result_ref = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND purpose = 'recovery' AND consumed_at IS NULL
             AND EXISTS (
               SELECT 1 FROM identity_recovery_code
               WHERE id = ? AND consumed_auth_intent_id = ? AND consume_nonce = ?
             )`,
        )
        .bind(
          now,
          createOpaqueToken(),
          code.id,
          createOpaqueToken(),
          intentId,
          code.id,
          intentId,
          consumeNonce,
        ),
      prepareSessionInsert(database, draft),
      await securityEventStatement(database, {
        eventType: 'account.recovery_code.used',
        severity: 'warning',
        actor: { type: 'account', accountId: target.account_id, sessionId: draft.record.id },
        targetAccountId: target.account_id,
        resource: { type: 'account', id: target.account_id },
        correlationId: draft.record.id,
        deduplicationScope: `recovery-code:${code.id}`,
        createdAt: now,
      }),
      ...replacementStatements(database, replacement, now),
    ])
  } catch {
    throw new RecoveryCodeError('conflict')
  }
  return { token: draft.token, absoluteExpiresAt: draft.record.absoluteExpiresAt } as const
}
