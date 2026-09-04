import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../opaque-token.ts'
import type { IdentityDatabase } from './internal/contracts.ts'
import {
  PASSWORD_KDF_ALGORITHM,
  createPasswordVerifier,
  passwordVerifierForStorage,
} from './internal/password-kdf.ts'
import type { PasswordPepperSet } from './internal/password-config.ts'
import {
  checkPwnedPassword,
  PasswordScreeningUnavailableError,
  type PwnedPasswordOptions,
} from './internal/password-screening.ts'
import { securityEventStatement } from './internal/security-event.ts'
import {
  evaluateSelfRegistration,
  type SelfRegistrationFailure,
  type SelfRegistrationFields,
} from './internal/self-registration-policy.ts'
import { createSessionDraft, prepareSessionInsert } from './internal/session-draft.ts'

const REGISTRATION_TTL_MS = 10 * 60 * 1000

export type AccountRegistrationResult =
  | {
      readonly ok: true
      readonly accountId: string
      readonly sessionId: string
      readonly token: string
      readonly absoluteExpiresAt: number
    }
  | {
      readonly ok: false
      readonly reason: 'invalid_input'
      readonly issue: SelfRegistrationFailure
    }
  | { readonly ok: false; readonly reason: 'username_unavailable' }
  | { readonly ok: false; readonly reason: 'password_compromised' }
  | { readonly ok: false; readonly reason: 'screening_unavailable' }

export interface RegisterAccountOptions extends PwnedPasswordOptions {
  readonly now?: number
  readonly clientLabel?: string
}

async function usernameAvailable(database: IdentityDatabase, username: string) {
  const existing = await database
    .prepare(
      `SELECT 1 AS present FROM identity_password_credential WHERE username = ?
       UNION ALL
       SELECT 1 AS present FROM identity_self_registration WHERE requested_username = ?
       LIMIT 1`,
    )
    .bind(username, username)
    .first<{ present: number }>()
  return !existing
}

function usernameCollision(error: unknown) {
  return (
    error instanceof Error &&
    /(?:UNIQUE constraint failed: (?:identity_password_credential\.username|identity_self_registration\.requested_username)|requested_username)/i.test(
      error.message,
    )
  )
}

export async function registerAccount(
  database: IdentityDatabase,
  fields: SelfRegistrationFields,
  peppers: PasswordPepperSet,
  options: RegisterAccountOptions = {},
): Promise<AccountRegistrationResult> {
  const policy = evaluateSelfRegistration(fields)
  if (!policy.ok) return { ok: false, reason: 'invalid_input', issue: policy.issue }
  if (!(await usernameAvailable(database, policy.value.username))) {
    return { ok: false, reason: 'username_unavailable' }
  }

  let screening
  try {
    screening = await checkPwnedPassword(policy.value.normalizedPassword, options)
  } catch (error) {
    if (error instanceof PasswordScreeningUnavailableError) {
      return { ok: false, reason: 'screening_unavailable' }
    }
    throw error
  }
  if (screening.compromised) return { ok: false, reason: 'password_compromised' }

  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid registration time')
  const verifier = passwordVerifierForStorage(
    await createPasswordVerifier(policy.value.normalizedPassword, peppers.active),
  )
  const accountId = createOpaqueToken()
  const passwordCredentialId = createOpaqueToken()
  const registrationId = createOpaqueToken()
  const verificationNonce = createOpaqueToken()
  const consumeNonce = createOpaqueToken()
  const session = await createSessionDraft({
    accountId,
    authentication: {
      method: 'password',
      passwordCredentialId,
      verificationNonce,
    },
    displayMetadata: options.clientLabel ? { clientLabel: options.clientLabel } : undefined,
    now,
  })
  const requestProof = createOpaqueToken()

  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_self_registration
            (id, request_proof_hash, expected_account_id, requested_username,
             requested_display_name, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          registrationId,
          await hashOpaqueToken(requestProof),
          accountId,
          policy.value.username,
          policy.value.displayName,
          now,
          now + REGISTRATION_TTL_MS,
        ),
      database
        .prepare(
          `INSERT INTO identity_account
            (id, webauthn_user_handle, display_name, status, verification_state,
             created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'legacy_unverified', ?, ?)`,
        )
        .bind(accountId, createOpaqueToken(), policy.value.displayName, now, now),
      database
        .prepare(
          `INSERT INTO identity_password_credential
            (id, account_id, username, algorithm, parameters_json, salt, password_hash,
             pepper_version, registration_kind, self_registration_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self_registration', ?, ?, ?)`,
        )
        .bind(
          passwordCredentialId,
          accountId,
          policy.value.username,
          PASSWORD_KDF_ALGORITHM,
          verifier.parameters_json,
          verifier.salt,
          verifier.password_hash,
          verifier.pepper_version,
          registrationId,
          now,
          now,
        ),
      database
        .prepare(
          `UPDATE identity_self_registration
           SET consumed_at = ?, consume_nonce = ?, password_credential_id = ?
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .bind(now, consumeNonce, passwordCredentialId, registrationId),
      database
        .prepare(
          `UPDATE identity_password_credential
           SET last_authenticated_at = ?, updated_at = ?, revision = revision + 1,
               write_nonce = ?
           WHERE id = ? AND revision = 0 AND status = 'active'`,
        )
        .bind(now, now, verificationNonce, passwordCredentialId),
      prepareSessionInsert(database, session),
      await securityEventStatement(database, {
        eventType: 'account.created',
        actor: { type: 'account', accountId, sessionId: session.record.id },
        targetAccountId: accountId,
        resource: { type: 'platform' },
        correlationId: session.record.id,
        deduplicationScope: `self-registration:${registrationId}`,
        details: { method: 'password' },
        createdAt: now,
      }),
    ])
  } catch (error) {
    if (usernameCollision(error)) return { ok: false, reason: 'username_unavailable' }
    throw error
  }

  return {
    ok: true,
    accountId,
    sessionId: session.record.id,
    token: session.token,
    absoluteExpiresAt: session.record.absoluteExpiresAt,
  }
}
