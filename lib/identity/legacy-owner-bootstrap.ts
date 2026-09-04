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
import { legacyCutoverStatements } from './internal/legacy-cutover.ts'
import {
  evaluateSelfRegistration,
  type SelfRegistrationFailure,
  type SelfRegistrationFields,
} from './internal/self-registration-policy.ts'
import { createSessionDraft, prepareSessionInsert } from './internal/session-draft.ts'

const BOOTSTRAP_TTL_MS = 60 * 60 * 1000
const HASH = /^[0-9a-f]{64}$/

interface LegacyAdminSessionRow {
  admin_id: number
  expires_at: number
}

export type LegacyOwnerBootstrapResult =
  | {
      readonly ok: true
      readonly accountId: string
      readonly token: string
      readonly absoluteExpiresAt: number
    }
  | {
      readonly ok: false
      readonly reason: 'invalid_input'
      readonly issue: SelfRegistrationFailure
    }
  | {
      readonly ok: false
      readonly reason:
        | 'unauthorized'
        | 'already_completed'
        | 'username_unavailable'
        | 'password_compromised'
        | 'screening_unavailable'
        | 'conflict'
    }

export interface LegacyOwnerBootstrapOptions extends PwnedPasswordOptions {
  readonly now?: number
  readonly legacyParticipantTokenHash?: string | null
}

async function bootstrapState(
  database: IdentityDatabase,
  legacySessionTokenHash: string,
  legacyParticipantTokenHash: string | null,
  username: string,
  now: number,
) {
  const [legacySession, opposingSession, owner, usernameRow, bootstrap] = await Promise.all([
    database
      .prepare(
        `SELECT admin_id, expires_at FROM admin_session
         WHERE token_hash = ? AND admin_id = 1 AND expires_at > ? LIMIT 1`,
      )
      .bind(legacySessionTokenHash, now)
      .first<LegacyAdminSessionRow>(),
    legacyParticipantTokenHash
      ? database
          .prepare(
            `SELECT 1 AS present FROM participant_session
             WHERE token_hash = ? AND expires_at > ? LIMIT 1`,
          )
          .bind(legacyParticipantTokenHash, now)
          .first<{ present: number }>()
      : null,
    database
      .prepare(
        `SELECT 1 AS present FROM identity_role_assignment
         WHERE role = 'platform_owner' AND scope_type = 'platform' AND revoked_at IS NULL LIMIT 1`,
      )
      .bind()
      .first<{ present: number }>(),
    database
      .prepare(
        `SELECT 1 AS present FROM identity_password_credential WHERE username = ?
         UNION ALL SELECT 1 AS present FROM identity_self_registration
         WHERE requested_username = ? LIMIT 1`,
      )
      .bind(username, username)
      .first<{ present: number }>(),
    database
      .prepare('SELECT status FROM identity_legacy_admin_bootstrap WHERE legacy_admin_id = 1')
      .bind()
      .first<{ status: string }>(),
  ])
  return {
    legacySession,
    opposingSession: Boolean(opposingSession),
    owner: Boolean(owner),
    usernameTaken: Boolean(usernameRow),
    bootstrap,
  }
}

function bootstrapConflict(error: unknown) {
  return (
    error instanceof Error &&
    /(?:constraint|bootstrap|platform owner|requested_username|credential\.username|insert conflict)/i.test(
      error.message,
    )
  )
}

export async function bootstrapLegacyPlatformOwner(
  database: IdentityDatabase,
  legacySessionTokenHash: string,
  fields: SelfRegistrationFields,
  peppers: PasswordPepperSet,
  options: LegacyOwnerBootstrapOptions = {},
): Promise<LegacyOwnerBootstrapResult> {
  if (!HASH.test(legacySessionTokenHash)) return { ok: false, reason: 'unauthorized' }
  const policy = evaluateSelfRegistration(fields)
  if (!policy.ok) return { ok: false, reason: 'invalid_input', issue: policy.issue }
  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid bootstrap time')
  const legacyParticipantTokenHash = options.legacyParticipantTokenHash ?? null
  if (legacyParticipantTokenHash !== null && !HASH.test(legacyParticipantTokenHash)) {
    throw new TypeError('Invalid legacy participant session hash')
  }
  const state = await bootstrapState(
    database,
    legacySessionTokenHash,
    legacyParticipantTokenHash,
    policy.value.username,
    now,
  )
  if (!state.legacySession) return { ok: false, reason: 'unauthorized' }
  if (state.opposingSession) return { ok: false, reason: 'conflict' }
  if (state.owner || state.bootstrap) return { ok: false, reason: 'already_completed' }
  if (state.usernameTaken) return { ok: false, reason: 'username_unavailable' }

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

  const accountId = createOpaqueToken()
  const passwordCredentialId = createOpaqueToken()
  const roleId = createOpaqueToken()
  const verifier = passwordVerifierForStorage(
    await createPasswordVerifier(policy.value.normalizedPassword, peppers.active),
  )
  const verificationNonce = createOpaqueToken()
  const session = await createSessionDraft({
    accountId,
    authentication: { method: 'password', passwordCredentialId, verificationNonce },
    now,
  })
  const expiresAt = Math.min(now + BOOTSTRAP_TTL_MS, state.legacySession.expires_at)
  if (expiresAt <= now) return { ok: false, reason: 'unauthorized' }

  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_legacy_admin_bootstrap
            (legacy_admin_id, secret_hash, legacy_session_token_hash, expected_account_id,
             issued_at, expires_at)
           VALUES (1, ?, ?, ?, ?, ?)`,
        )
        .bind(
          await hashOpaqueToken(createOpaqueToken()),
          legacySessionTokenHash,
          accountId,
          now,
          expiresAt,
        ),
      database
        .prepare(
          `INSERT INTO identity_account
            (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
           VALUES (?, ?, ?, 'active', 'legacy_unverified', ?, ?)`,
        )
        .bind(accountId, createOpaqueToken(), policy.value.displayName, now, now),
      ...legacyCutoverStatements(database, {
        subjectType: 'admin_account',
        subjectId: '1',
        accountId,
        sourceRevision: 0,
        sourceSnapshotHash: await hashOpaqueToken('legacy-admin:1'),
        cohortKey: 'legacy_admin',
        now,
      }),
      database
        .prepare(
          `INSERT INTO identity_password_credential
            (id, account_id, username, algorithm, parameters_json, salt, password_hash,
             pepper_version, registration_kind, legacy_admin_bootstrap_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'legacy_admin_bootstrap', 1, ?, ?)`,
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
          now,
          now,
        ),
      database
        .prepare(
          `UPDATE identity_legacy_admin_bootstrap
           SET status = 'consumed', consumed_at = ?, consume_nonce = ?,
               password_credential_id = ?, revision = 1, write_nonce = ?
           WHERE legacy_admin_id = 1 AND status = 'open'
             AND (? IS NULL OR NOT EXISTS (
               SELECT 1 FROM participant_session
               WHERE token_hash = ? AND expires_at > ?
             ))`,
        )
        .bind(
          now,
          createOpaqueToken(),
          passwordCredentialId,
          createOpaqueToken(),
          legacyParticipantTokenHash,
          legacyParticipantTokenHash,
          now,
        ),
      database
        .prepare(
          `UPDATE identity_password_credential
           SET last_authenticated_at = ?, updated_at = ?, revision = 1, write_nonce = ?
           WHERE id = ? AND revision = 0 AND status = 'active'`,
        )
        .bind(now, now, verificationNonce, passwordCredentialId),
      prepareSessionInsert(database, session),
      database
        .prepare(
          `INSERT INTO identity_role_assignment
            (id, account_id, role, scope_type, grant_reason, granted_at)
           VALUES (?, ?, 'platform_owner', 'platform', 'Legacy owner one-time migration', ?)`,
        )
        .bind(roleId, accountId, now),
      database
        .prepare(
          `UPDATE identity_legacy_admin_bootstrap
           SET status = 'completed', owner_role_assignment_id = (
                 SELECT assignment.id
                 FROM identity_role_assignment AS assignment
                 JOIN identity_session AS session ON session.id = ?
                 WHERE assignment.id = ? AND assignment.account_id = ?
                   AND session.account_id = assignment.account_id
                   AND session.auth_method = 'password'
                   AND session.password_credential_id = ?
                   AND session.authenticated_at = ?
               ), completed_at = ?,
               revision = 2, write_nonce = ?
           WHERE legacy_admin_id = 1 AND status = 'consumed'`,
        )
        .bind(
          session.record.id,
          roleId,
          accountId,
          passwordCredentialId,
          now,
          now,
          createOpaqueToken(),
        ),
      await securityEventStatement(database, {
        eventType: 'account.legacy_owner_bootstrapped',
        actor: { type: 'account', accountId, sessionId: session.record.id },
        targetAccountId: accountId,
        resource: { type: 'platform' },
        correlationId: session.record.id,
        deduplicationScope: `legacy-owner:${roleId}`,
        details: { legacyAdminId: 1 },
        retentionClass: 'access_control',
        createdAt: now,
      }),
      database.prepare('DELETE FROM admin_session WHERE admin_id = 1').bind(),
    ])
  } catch (error) {
    if (bootstrapConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }

  return {
    ok: true,
    accountId,
    token: session.token,
    absoluteExpiresAt: session.record.absoluteExpiresAt,
  }
}
