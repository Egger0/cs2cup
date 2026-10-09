import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../opaque-token.ts'
import type { IdentityDatabase } from './internal/contracts.ts'
import {
  PASSWORD_KDF_ALGORITHM,
  createPasswordVerifier,
  passwordVerifierForStorage,
} from './internal/password-kdf.ts'
import type { PasswordPepperSet } from './internal/password-config.ts'
import { securityEventStatement } from './internal/security-event.ts'
import {
  membershipFieldsAreSubmittable,
  membershipSubmissionDigest,
  normalizeMembershipApplicationFields,
  type MembershipApplicationFields,
  type MembershipFieldIssue,
} from './internal/membership-policy.ts'
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
      readonly issue: SelfRegistrationFailure | MembershipFieldIssue
    }
  | { readonly ok: false; readonly reason: 'username_unavailable' }
  | { readonly ok: false; readonly reason: 'password_compromised' }

export interface RegisterAccountOptions {
  readonly now?: number
  readonly clientLabel?: string
  readonly membership?: MembershipApplicationFields
  readonly beforeCreate?: () => Promise<void>
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
  const membership = options.membership
    ? normalizeMembershipApplicationFields(options.membership)
    : null
  if (membership && !membership.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      issue: { field: membership.field, reason: membership.reason },
    }
  }
  if (membership?.ok && !membershipFieldsAreSubmittable(membership.value)) {
    return {
      ok: false,
      reason: 'invalid_input',
      issue: {
        field: membership.value.identityClaim === null ? 'identityClaim' : 'contact',
        reason: 'too_short',
      },
    }
  }
  if (!(await usernameAvailable(database, policy.value.username))) {
    return { ok: false, reason: 'username_unavailable' }
  }
  await options.beforeCreate?.()

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
  const applicationId = createOpaqueToken()
  const membershipStatements = []
  if (membership?.ok) {
    const digest = await membershipSubmissionDigest(membership.value)
    membershipStatements.push(
      database
        .prepare(
          `INSERT INTO identity_membership_application
            (id, account_id, identity_claim, contact, application_reason,
             last_applicant_update_at, last_applicant_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          applicationId,
          accountId,
          membership.value.identityClaim,
          membership.value.contact,
          membership.value.applicationReason,
          now,
          session.record.id,
          now,
          now,
        ),
      database
        .prepare(
          `UPDATE identity_membership_application
           SET status = 'pending', submission_version = 1, submission_digest = ?,
               submitted_at = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        )
        .bind(digest, now, createOpaqueToken(), applicationId),
      await securityEventStatement(database, {
        eventType: 'membership.application.submitted',
        actor: { type: 'account', accountId, sessionId: session.record.id },
        targetAccountId: accountId,
        resource: { type: 'membership_application', id: applicationId },
        correlationId: session.record.id,
        deduplicationScope: `membership.application.submitted:${applicationId}`,
        details: { submissionVersion: 1, submissionDigest: digest },
        retentionClass: 'access_control',
        createdAt: now,
      }),
    )
  }

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
      ...membershipStatements,
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
