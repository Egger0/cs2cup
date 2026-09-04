import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import { passwordChangeState, validateCurrentPassword } from './password-change-state.ts'
import type { PasswordPepperSet } from './password-config.ts'
import {
  createPasswordVerifier,
  passwordVerifierForStorage,
  passwordVerifierFromStorage,
  verifyPassword,
} from './password-kdf.ts'
import { evaluatePasswordPolicy } from './password-policy.ts'
import {
  checkPwnedPassword,
  containsPasswordContext,
  PasswordScreeningUnavailableError,
  type PwnedPasswordOptions,
} from './password-screening.ts'
import { createSessionDraft, prepareSessionInsert } from './session-draft.ts'
import { securityEventStatement } from './security-event.ts'
import { privateSessionContext } from './session-context.ts'

const INTENT_TTL_MS = 5 * 60 * 1000

export type PasswordChangeFailure =
  | 'invalid_input'
  | 'invalid_current_password'
  | 'temporarily_locked'
  | 'password_reused'
  | 'password_context'
  | 'password_compromised'
  | 'screening_unavailable'
  | 'not_authenticated'
  | 'unsupported_recovery'
  | 'configuration_unavailable'
  | 'conflict'

export type PasswordChangeResult =
  | {
      readonly ok: true
      readonly token: string
      readonly absoluteExpiresAt: number
    }
  | { readonly ok: false; readonly reason: PasswordChangeFailure }

export async function changeAccountPassword(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { currentPassword?: unknown; password: unknown; passwordConfirmation: unknown },
  peppers: PasswordPepperSet,
  options: PwnedPasswordOptions & { now?: number } = {},
): Promise<PasswordChangeResult> {
  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - INTENT_TTL_MS) {
    throw new TypeError('Invalid password-change time')
  }
  const privateContext = privateSessionContext(context)
  if (!privateContext) return { ok: false, reason: 'not_authenticated' }
  const row = await passwordChangeState(database, context, privateContext.tokenHash, now)
  if (!row) return { ok: false, reason: 'not_authenticated' }
  const recovery = context.session.recoveryRestricted
  if (recovery && row.auth_method !== 'recovery_code') {
    return { ok: false, reason: 'unsupported_recovery' }
  }
  if (!recovery) {
    const failure = await validateCurrentPassword(
      database,
      row,
      input.currentPassword,
      peppers,
      now,
    )
    if (failure) return { ok: false, reason: failure }
  }

  const policy = evaluatePasswordPolicy(input.password)
  if (!policy.ok || input.passwordConfirmation !== input.password) {
    return { ok: false, reason: 'invalid_input' }
  }
  if (
    containsPasswordContext(policy.normalizedPassword, [row.username, row.display_name, 'cs2cup'])
  ) {
    return { ok: false, reason: 'password_context' }
  }
  const oldRecord = passwordVerifierFromStorage(row)
  const oldPepper = oldRecord ? peppers.byVersion.get(oldRecord.pepperVersion) : null
  if (!oldRecord || !oldPepper) return { ok: false, reason: 'configuration_unavailable' }
  if (await verifyPassword(policy.normalizedPassword, oldRecord, oldPepper)) {
    return { ok: false, reason: 'password_reused' }
  }
  try {
    if ((await checkPwnedPassword(policy.normalizedPassword, options)).compromised) {
      return { ok: false, reason: 'password_compromised' }
    }
  } catch (error) {
    if (error instanceof PasswordScreeningUnavailableError) {
      return { ok: false, reason: 'screening_unavailable' }
    }
    throw error
  }

  const verifier = passwordVerifierForStorage(
    await createPasswordVerifier(policy.normalizedPassword, peppers.active),
  )
  const confirmationAt = Math.max(now, (row.last_authenticated_at ?? -1) + 1)
  const changedAt = confirmationAt + 1
  const authenticatedAt = changedAt + 1
  const changeId = createOpaqueToken()
  const finalVerificationNonce = createOpaqueToken()
  const draft = await createSessionDraft({
    accountId: context.account.id,
    authentication: {
      method: 'password',
      passwordCredentialId: row.credential_id,
      verificationNonce: finalVerificationNonce,
    },
    displayMetadata: row.client_label ? { clientLabel: row.client_label } : undefined,
    now: authenticatedAt,
  })
  const statements = []
  let confirmationIntentId: string
  let credentialRevision = row.credential_revision
  if (recovery) {
    if (!row.recovery_auth_intent_id) return { ok: false, reason: 'conflict' }
    confirmationIntentId = row.recovery_auth_intent_id
  } else {
    confirmationIntentId = createOpaqueToken()
    const intentConsumeNonce = createOpaqueToken()
    statements.push(
      database
        .prepare(
          `INSERT INTO identity_auth_intent
            (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
             idempotency_key, max_attempts, created_at, expires_at)
           VALUES (?, ?, 'sensitive_confirmation', ?, 'account_security', ?, ?, 1, ?, ?)`,
        )
        .bind(
          confirmationIntentId,
          await hashOpaqueToken(createOpaqueToken()),
          context.account.id,
          createOpaqueToken(),
          await hashOpaqueToken(createOpaqueToken()),
          confirmationAt,
          confirmationAt + INTENT_TTL_MS,
        ),
      database
        .prepare(
          `UPDATE identity_password_credential
           SET failed_attempt_count = 0, last_failed_at = NULL, locked_until = NULL,
               last_authenticated_at = ?, updated_at = ?, revision = revision + 1,
               write_nonce = ?
           WHERE id = ? AND account_id = ? AND status = 'active' AND revision = ?`,
        )
        .bind(
          confirmationAt,
          confirmationAt,
          createOpaqueToken(),
          row.credential_id,
          context.account.id,
          credentialRevision,
        ),
      database
        .prepare(
          `UPDATE identity_auth_intent
           SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'password_credential',
               completion_result_ref = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND purpose = 'sensitive_confirmation' AND consumed_at IS NULL`,
        )
        .bind(
          confirmationAt,
          intentConsumeNonce,
          row.credential_id,
          createOpaqueToken(),
          confirmationIntentId,
        ),
      database
        .prepare(
          `INSERT INTO identity_password_change_confirmation
            (auth_intent_id, account_id, initiating_session_id, confirmation_method,
             proof_credential_id, confirmed_at)
           VALUES (?, ?, ?, 'password', ?, ?)`,
        )
        .bind(
          confirmationIntentId,
          context.account.id,
          context.session.id,
          row.credential_id,
          confirmationAt,
        ),
    )
    credentialRevision += 1
  }
  statements.push(
    database
      .prepare(
        `INSERT INTO identity_password_change
          (id, credential_id, account_id, change_kind, authorizing_session_id,
           confirmation_auth_intent_id, from_secret_version, to_secret_version,
           target_security_version, changed_at, request_correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        changeId,
        row.credential_id,
        context.account.id,
        recovery ? 'recovery_code' : 'authenticated_change',
        context.session.id,
        confirmationIntentId,
        row.secret_version,
        row.secret_version + 1,
        row.security_version + 1,
        changedAt,
        createOpaqueToken(),
      ),
  )
  if (recovery) {
    statements.push(
      database
        .prepare(
          `UPDATE identity_recovery_code_set
           SET status = 'revoked', closed_at = ?, revision = revision + 1, write_nonce = ?
           WHERE account_id = ? AND status = 'active' AND EXISTS (
             SELECT 1 FROM identity_recovery_code AS code
             JOIN identity_session AS recovery_session
               ON recovery_session.recovery_code_id = code.id
             WHERE code.set_id = identity_recovery_code_set.id
               AND recovery_session.id = ? AND recovery_session.account_id = ?
           )`,
        )
        .bind(
          changedAt,
          createOpaqueToken(),
          context.account.id,
          context.session.id,
          context.account.id,
        ),
    )
  }
  statements.push(
    database
      .prepare(
        `UPDATE identity_password_credential
         SET secret_version = secret_version + 1, algorithm = ?, parameters_json = ?, salt = ?,
             password_hash = ?, pepper_version = ?, failed_attempt_count = 0,
             last_failed_at = NULL, locked_until = NULL, last_change_id = ?, updated_at = ?,
             revision = revision + 1, write_nonce = ?
         WHERE id = ? AND account_id = ? AND status = 'active' AND secret_version = ?
           AND revision = ?`,
      )
      .bind(
        verifier.algorithm,
        verifier.parameters_json,
        verifier.salt,
        verifier.password_hash,
        verifier.pepper_version,
        changeId,
        changedAt,
        changeId,
        row.credential_id,
        context.account.id,
        row.secret_version,
        credentialRevision,
      ),
    database
      .prepare(
        `UPDATE identity_password_credential
         SET last_authenticated_at = ?, updated_at = ?, revision = revision + 1, write_nonce = ?
         WHERE id = ? AND account_id = ? AND status = 'active'
           AND last_change_id = ? AND write_nonce = ?`,
      )
      .bind(
        authenticatedAt,
        authenticatedAt,
        finalVerificationNonce,
        row.credential_id,
        context.account.id,
        changeId,
        changeId,
      ),
    prepareSessionInsert(database, draft),
    await securityEventStatement(database, {
      eventType: recovery ? 'account.password.recovered' : 'account.password.changed',
      severity: 'warning',
      actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
      targetAccountId: context.account.id,
      resource: { type: 'account', id: context.account.id },
      correlationId: changeId,
      deduplicationScope: `password-change:${changeId}`,
      details: { sessionsRevoked: true, method: recovery ? 'recovery_code' : 'password' },
      createdAt: authenticatedAt,
    }),
  )
  try {
    await database.batch(statements)
  } catch {
    return { ok: false, reason: 'conflict' }
  }
  const inserted = await database
    .prepare('SELECT 1 AS present FROM identity_session WHERE id = ? AND token_hash = ? LIMIT 1')
    .bind(draft.record.id, draft.record.tokenHash)
    .first<{ present: number }>()
  return inserted
    ? { ok: true, token: draft.token, absoluteExpiresAt: draft.record.absoluteExpiresAt }
    : { ok: false, reason: 'conflict' }
}
