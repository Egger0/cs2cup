import 'server-only'

import { hashOpaqueToken, isOpaqueToken } from '../../opaque-token.ts'
import {
  OPAQUE_ID,
  PASSKEY_CREDENTIAL_ID,
  validTimestamp,
  type AuthContext,
  type AuthenticatedAuthContext,
  type IdentityAuthMethod,
  type IdentityDatabase,
  type VerificationState,
} from './contracts.ts'
import { rememberSessionContext } from './session-context.ts'

const AUTH_METHODS = new Set<IdentityAuthMethod>([
  'passkey',
  'password',
  'oidc',
  'cas',
  'email_otp',
  'recovery_code',
  'assisted_recovery',
])
const RECOVERY_METHODS = new Set<IdentityAuthMethod>([
  'oidc',
  'cas',
  'email_otp',
  'recovery_code',
  'assisted_recovery',
])
const VERIFICATION_STATES = new Set<VerificationState>(['legacy_unverified', 'verified'])

interface SessionRow {
  session_id: string
  account_id: string
  display_name: string
  verification_state: VerificationState
  auth_method: IdentityAuthMethod
  authenticator_credential_id: string | null
  password_credential_id: string | null
  password_verification_nonce: string | null
  passkey_auth_intent_id: string | null
  recovery_code_id: string | null
  recovery_auth_intent_id: string | null
  created_at: number
  last_seen_at: number
  idle_expires_at: number
  absolute_expires_at: number
  authenticated_at: number
  phishing_resistant_at: number | null
  recovery_verified_at: number | null
  recovery_restricted: number
  revision: number
}

function validSessionRow(row: SessionRow, now: number) {
  const requiredTimes = [
    row.created_at,
    row.last_seen_at,
    row.idle_expires_at,
    row.absolute_expires_at,
    row.authenticated_at,
  ]
  if (
    !OPAQUE_ID.test(row.session_id) ||
    !OPAQUE_ID.test(row.account_id) ||
    !AUTH_METHODS.has(row.auth_method) ||
    !VERIFICATION_STATES.has(row.verification_state) ||
    !requiredTimes.every(validTimestamp) ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    row.created_at > row.authenticated_at ||
    row.authenticated_at > row.last_seen_at ||
    row.last_seen_at > now ||
    row.idle_expires_at <= now ||
    row.absolute_expires_at <= now ||
    row.idle_expires_at > row.absolute_expires_at ||
    ![0, 1].includes(row.recovery_restricted)
  ) {
    return false
  }
  for (const assuranceAt of [row.phishing_resistant_at, row.recovery_verified_at]) {
    if (assuranceAt !== null && (!validTimestamp(assuranceAt) || assuranceAt > now)) return false
  }
  const passkey = row.auth_method === 'passkey'
  if (passkey) {
    if (
      !PASSKEY_CREDENTIAL_ID.test(row.authenticator_credential_id ?? '') ||
      !OPAQUE_ID.test(row.passkey_auth_intent_id ?? '') ||
      row.phishing_resistant_at === null
    ) {
      return false
    }
  } else if (
    row.authenticator_credential_id !== null ||
    row.passkey_auth_intent_id !== null ||
    row.phishing_resistant_at !== null
  ) {
    return false
  }
  const password = row.auth_method === 'password'
  if (
    password !== OPAQUE_ID.test(row.password_credential_id ?? '') ||
    password !== OPAQUE_ID.test(row.password_verification_nonce ?? '')
  ) {
    return false
  }
  const restricted = row.recovery_restricted === 1
  if (
    restricted !== (row.recovery_verified_at !== null) ||
    restricted !== OPAQUE_ID.test(row.recovery_auth_intent_id ?? '') ||
    (restricted &&
      (!RECOVERY_METHODS.has(row.auth_method) || row.phishing_resistant_at !== null)) ||
    (!restricted && !['passkey', 'password'].includes(row.auth_method)) ||
    (row.auth_method === 'recovery_code') !== OPAQUE_ID.test(row.recovery_code_id ?? '')
  ) {
    return false
  }
  return typeof row.display_name === 'string' && row.display_name.trim().length > 0
}

export async function resolveAuthContextFromHash(
  database: IdentityDatabase,
  tokenHash: string,
  now: number,
): Promise<AuthContext> {
  const row = await database
    .prepare(
      `SELECT session.id AS session_id, session.account_id, account.display_name,
              account.verification_state, session.auth_method,
              session.authenticator_credential_id, session.password_credential_id,
              session.password_verification_nonce, session.passkey_auth_intent_id,
              session.recovery_code_id,
              session.recovery_auth_intent_id,
              session.created_at, session.last_seen_at, session.idle_expires_at,
              session.absolute_expires_at, session.authenticated_at,
              session.phishing_resistant_at, session.recovery_verified_at,
              session.recovery_restricted, session.revision
       FROM identity_session AS session
       JOIN identity_account AS account ON account.id = session.account_id
       WHERE session.token_hash = ? AND session.revoked_at IS NULL
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         AND session.authenticated_at <= ?
         AND (session.phishing_resistant_at IS NULL OR session.phishing_resistant_at <= ?)
         AND (session.recovery_verified_at IS NULL OR session.recovery_verified_at <= ?)
         AND account.status = 'active' AND account.security_version = session.security_version
         AND (session.auth_method != 'password' OR EXISTS (
           SELECT 1 FROM identity_password_credential AS password
           WHERE password.id = session.password_credential_id
             AND password.account_id = session.account_id AND password.status = 'active'
         ))
         AND (session.auth_method != 'passkey' OR EXISTS (
           SELECT 1 FROM identity_passkey_credential AS credential
           JOIN identity_auth_intent AS intent ON intent.id = session.passkey_auth_intent_id
           WHERE credential.credential_id = session.authenticator_credential_id
             AND credential.account_id = session.account_id AND credential.status = 'active'
             AND intent.purpose IN ('passkey_sign_in', 'passkey_step_up')
             AND (intent.expected_account_id IS NULL
               OR intent.expected_account_id = session.account_id)
             AND intent.consumed_at = session.authenticated_at
             AND intent.completion_result_type = 'passkey_credential'
             AND intent.completion_result_ref = credential.credential_id
             AND session.phishing_resistant_at = intent.consumed_at
         ))
       LIMIT 1`,
    )
    .bind(tokenHash, now, now, now, now, now)
    .first<SessionRow>()
  if (!row || !validSessionRow(row, now)) return { kind: 'anonymous' }
  const context: AuthenticatedAuthContext = Object.freeze({
    kind: 'authenticated',
    account: Object.freeze({
      id: row.account_id,
      displayName: row.display_name,
      verificationState: row.verification_state,
    }),
    session: Object.freeze({
      id: row.session_id,
      authMethod: row.auth_method,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      authenticatedAt: row.authenticated_at,
      phishingResistantAt: row.phishing_resistant_at,
      recoveryVerifiedAt: row.recovery_verified_at,
      recoveryRestricted: row.recovery_restricted === 1,
    }),
  })
  return rememberSessionContext(context, tokenHash, row.revision)
}

export async function resolveAuthContext(
  database: IdentityDatabase,
  token: string | null,
  now = Date.now(),
) {
  if (!token || !isOpaqueToken(token) || !validTimestamp(now)) return { kind: 'anonymous' } as const
  return resolveAuthContextFromHash(database, await hashOpaqueToken(token), now)
}
