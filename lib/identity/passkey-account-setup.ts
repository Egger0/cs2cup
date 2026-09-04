import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import type { PasswordPepperSet } from './internal/password-config.ts'
import {
  PASSWORD_KDF_ALGORITHM,
  createPasswordVerifier,
  passwordVerifierForStorage,
} from './internal/password-kdf.ts'
import { evaluatePasswordPolicy } from './internal/password-policy.ts'
import {
  checkPwnedPassword,
  containsPasswordContext,
  PasswordScreeningUnavailableError,
  type PwnedPasswordOptions,
} from './internal/password-screening.ts'
import {
  hasRecentAuthentication,
  RECENT_AUTHENTICATION_MS,
} from './internal/recent-authentication.ts'
import { securityEventStatement } from './internal/security-event.ts'
import { privateSessionContext } from './internal/session-context.ts'
import { evaluateUsernamePolicy } from './internal/username-policy.ts'

const SETUP_TTL_MS = 10 * 60 * 1000

export type PasskeyAccountSetupFailure =
  | 'invalid_input'
  | 'username_unavailable'
  | 'password_context'
  | 'password_compromised'
  | 'screening_unavailable'
  | 'not_authenticated'
  | 'recovery_restricted'
  | 'passkey_required'
  | 'reauth_required'
  | 'not_eligible'
  | 'already_configured'
  | 'conflict'

export type PasskeyAccountSetupResult =
  | { readonly ok: true; readonly username: string }
  | {
      readonly ok: false
      readonly reason: PasskeyAccountSetupFailure
      readonly field?: 'username' | 'password' | 'passwordConfirmation'
    }

interface SetupAccountRow {
  display_name: string
  password_count: number
  legacy_ready: number
}

async function setupAccount(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  tokenHash: string,
  now: number,
) {
  return database
    .prepare(
      `SELECT account.display_name,
              (SELECT COUNT(*) FROM identity_password_credential AS password
               WHERE password.account_id = account.id) AS password_count,
              (EXISTS(
                SELECT 1 FROM identity_legacy_subject_map AS legacy
                JOIN identity_cutover AS cutover ON cutover.account_id = legacy.account_id
                WHERE legacy.account_id = account.id
                  AND legacy.subject_type = 'participant_principal'
                  AND cutover.cohort_key = 'legacy_participant' AND cutover.phase = 3
              )) AS legacy_ready
       FROM identity_session AS session
       JOIN identity_account AS account ON account.id = session.account_id
       JOIN identity_passkey_credential AS passkey
         ON passkey.credential_id = session.authenticator_credential_id
        AND passkey.account_id = session.account_id
       WHERE session.id = ? AND session.account_id = ? AND session.token_hash = ?
         AND session.auth_method = 'passkey' AND session.revoked_at IS NULL
         AND session.recovery_restricted = 0
         AND session.security_version = account.security_version
         AND session.authenticated_at >= ? AND session.authenticated_at <= ?
         AND session.phishing_resistant_at >= ? AND session.phishing_resistant_at <= ?
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         AND account.status = 'active' AND account.verification_state = 'legacy_unverified'
         AND passkey.status = 'active' LIMIT 1`,
    )
    .bind(
      context.session.id,
      context.account.id,
      tokenHash,
      now - RECENT_AUTHENTICATION_MS,
      now,
      now - RECENT_AUTHENTICATION_MS,
      now,
      now,
      now,
    )
    .first<SetupAccountRow>()
}

async function usernameAvailable(database: IdentityDatabase, username: string) {
  const row = await database
    .prepare(
      `SELECT 1 AS present FROM identity_password_credential WHERE username = ?
       UNION ALL SELECT 1 FROM identity_self_registration WHERE requested_username = ?
       UNION ALL SELECT 1 FROM identity_passkey_account_setup WHERE requested_username = ?
       LIMIT 1`,
    )
    .bind(username, username, username)
    .first<{ present: number }>()
  return !row
}

function usernameCollision(error: unknown) {
  return (
    error instanceof Error &&
    /(?:username|requested_username|identity_self_registration)/i.test(error.message)
  )
}

function setupPolicy(
  input: { username: unknown; password: unknown; passwordConfirmation: unknown },
  displayName: string,
):
  | { ok: true; username: string; password: string }
  | {
      ok: false
      reason: 'invalid_input' | 'password_context'
      field: 'username' | 'password' | 'passwordConfirmation'
    } {
  const username = evaluateUsernamePolicy(input.username)
  if (!username.ok) return { ok: false, reason: 'invalid_input', field: 'username' }
  const password = evaluatePasswordPolicy(input.password)
  if (!password.ok) return { ok: false, reason: 'invalid_input', field: 'password' }
  if (
    typeof input.passwordConfirmation !== 'string' ||
    input.passwordConfirmation.normalize('NFC') !== password.normalizedPassword
  ) {
    return { ok: false, reason: 'invalid_input', field: 'passwordConfirmation' }
  }
  if (
    containsPasswordContext(password.normalizedPassword, [
      username.username,
      displayName,
      'cs2cup',
      '宁波理工电竞社',
    ])
  ) {
    return { ok: false, reason: 'password_context', field: 'password' }
  }
  return { ok: true, username: username.username, password: password.normalizedPassword }
}

export async function completePasskeyAccountSetup(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { username: unknown; password: unknown; passwordConfirmation: unknown },
  peppers: PasswordPepperSet,
  options: PwnedPasswordOptions & { now?: number } = {},
): Promise<PasskeyAccountSetupResult> {
  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - SETUP_TTL_MS) {
    throw new TypeError('Invalid account-setup time')
  }
  const privateContext = privateSessionContext(context)
  if (!privateContext) return { ok: false, reason: 'not_authenticated' }
  if (context.session.recoveryRestricted) return { ok: false, reason: 'recovery_restricted' }
  if (context.session.authMethod !== 'passkey' || context.session.phishingResistantAt === null) {
    return { ok: false, reason: 'passkey_required' }
  }
  if (
    !hasRecentAuthentication(context, now) ||
    context.session.phishingResistantAt < now - RECENT_AUTHENTICATION_MS ||
    context.session.phishingResistantAt > now
  ) {
    return { ok: false, reason: 'reauth_required' }
  }

  const account = await setupAccount(database, context, privateContext.tokenHash, now)
  if (!account) return { ok: false, reason: 'not_authenticated' }
  if (Number(account.password_count) > 0) return { ok: false, reason: 'already_configured' }
  if (account.legacy_ready !== 1) return { ok: false, reason: 'not_eligible' }
  const policy = setupPolicy(input, account.display_name)
  if (!policy.ok) return policy
  if (!(await usernameAvailable(database, policy.username))) {
    return { ok: false, reason: 'username_unavailable', field: 'username' }
  }
  try {
    if ((await checkPwnedPassword(policy.password, options)).compromised) {
      return { ok: false, reason: 'password_compromised', field: 'password' }
    }
  } catch (error) {
    if (error instanceof PasswordScreeningUnavailableError) {
      return { ok: false, reason: 'screening_unavailable', field: 'password' }
    }
    throw error
  }

  const verifier = passwordVerifierForStorage(
    await createPasswordVerifier(policy.password, peppers.active),
  )
  const setupId = createOpaqueToken()
  const credentialId = createOpaqueToken()
  const consumeNonce = createOpaqueToken()
  const writeNonce = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_passkey_account_setup
            (id, account_id, initiating_session_id, requested_username, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          setupId,
          context.account.id,
          context.session.id,
          policy.username,
          now,
          now + SETUP_TTL_MS,
        ),
      database
        .prepare(
          `INSERT INTO identity_self_registration
            (id, request_proof_hash, expected_account_id, requested_username,
             requested_display_name, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          setupId,
          await hashOpaqueToken(createOpaqueToken()),
          context.account.id,
          policy.username,
          account.display_name,
          now,
          now + SETUP_TTL_MS,
        ),
      database
        .prepare(
          `INSERT INTO identity_password_credential
            (id, account_id, username, algorithm, parameters_json, salt, password_hash,
             pepper_version, registration_kind, self_registration_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'self_registration', ?, ?, ?)`,
        )
        .bind(
          credentialId,
          context.account.id,
          policy.username,
          PASSWORD_KDF_ALGORITHM,
          verifier.parameters_json,
          verifier.salt,
          verifier.password_hash,
          verifier.pepper_version,
          setupId,
          now,
          now,
        ),
      database
        .prepare(
          `UPDATE identity_self_registration
           SET consumed_at = ?, consume_nonce = ?, password_credential_id = ?
           WHERE id = ? AND consumed_at IS NULL`,
        )
        .bind(now, consumeNonce, credentialId, setupId),
      database
        .prepare(
          `UPDATE identity_passkey_account_setup
           SET consumed_at = ?, consume_nonce = ?, password_credential_id = ?,
               revision = revision + 1, write_nonce = ?
           WHERE id = ? AND revision = 0 AND consumed_at IS NULL`,
        )
        .bind(now, consumeNonce, credentialId, writeNonce, setupId),
      await securityEventStatement(database, {
        eventType: 'account.password.created',
        actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
        targetAccountId: context.account.id,
        resource: { type: 'account', id: context.account.id },
        correlationId: setupId,
        deduplicationScope: `passkey-account-setup:${setupId}`,
        details: { method: 'passkey', sessionsRevoked: false },
        createdAt: now,
      }),
    ])
  } catch (error) {
    const collision = usernameCollision(error)
    return {
      ok: false,
      reason: collision ? 'username_unavailable' : 'conflict',
      ...(collision ? { field: 'username' as const } : {}),
    }
  }
  const completed = await database
    .prepare(
      `SELECT credential.username FROM identity_passkey_account_setup AS setup
       JOIN identity_password_credential AS credential
         ON credential.id = setup.password_credential_id
       WHERE setup.id = ? AND setup.account_id = ? AND setup.consumed_at = ?
         AND credential.status = 'active' LIMIT 1`,
    )
    .bind(setupId, context.account.id, now)
    .first<{ username: string }>()
  return completed?.username === policy.username
    ? { ok: true, username: policy.username }
    : { ok: false, reason: 'conflict' }
}
