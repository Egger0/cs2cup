import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import {
  OPAQUE_ID,
  PASSKEY_CREDENTIAL_ID,
  validTimestamp,
  type CreateSessionDraftInput,
  type IdentityAuthMethod,
  type IdentityDatabase,
  type SessionDraft,
} from './contracts.ts'

export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000
export const RECOVERY_SESSION_IDLE_MS = 15 * 60 * 1000
export const RECOVERY_SESSION_ABSOLUTE_MS = 30 * 60 * 1000
export const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000

const issuedSessionDrafts = new WeakSet<SessionDraft>()

const DRAFT_AUTH_METHODS = new Set<IdentityAuthMethod>([
  'passkey',
  'password',
  'oidc',
  'cas',
  'email_otp',
  'recovery_code',
  'assisted_recovery',
])

function displayMetadataJson(value: CreateSessionDraftInput['displayMetadata']) {
  if (value === undefined) return '{}'
  if (value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('Session display metadata must be a plain object')
  }
  const serialized = JSON.stringify(value)
  if (serialized.length > 2048) throw new RangeError('Session display metadata is too large')
  return serialized
}

function sessionProvenance(authentication: CreateSessionDraftInput['authentication'], now: number) {
  if (authentication.method === 'passkey') {
    if (
      !PASSKEY_CREDENTIAL_ID.test(authentication.authenticatorCredentialId) ||
      !OPAQUE_ID.test(authentication.authIntentId)
    ) {
      throw new TypeError('Invalid Passkey authentication provenance')
    }
    return {
      authenticatorCredentialId: authentication.authenticatorCredentialId,
      passwordCredentialId: null,
      passwordVerificationNonce: null,
      passkeyAuthIntentId: authentication.authIntentId,
      recoveryCodeId: null,
      recoveryAuthIntentId: null,
      phishingResistantAt: now,
      recoveryVerifiedAt: null,
      recoveryRestricted: false,
    }
  }
  if (authentication.method === 'password') {
    if (
      !OPAQUE_ID.test(authentication.passwordCredentialId) ||
      !OPAQUE_ID.test(authentication.verificationNonce)
    ) {
      throw new TypeError('Invalid password authentication provenance')
    }
    return {
      authenticatorCredentialId: null,
      passwordCredentialId: authentication.passwordCredentialId,
      passwordVerificationNonce: authentication.verificationNonce,
      passkeyAuthIntentId: null,
      recoveryCodeId: null,
      recoveryAuthIntentId: null,
      phishingResistantAt: null,
      recoveryVerifiedAt: null,
      recoveryRestricted: false,
    }
  }
  if (authentication.method === 'recovery_code') {
    if (
      !OPAQUE_ID.test(authentication.recovery.authIntentId) ||
      !OPAQUE_ID.test(authentication.recovery.recoveryCodeId)
    ) {
      throw new TypeError('Invalid recovery provenance')
    }
    return {
      authenticatorCredentialId: null,
      passwordCredentialId: null,
      passwordVerificationNonce: null,
      passkeyAuthIntentId: null,
      recoveryCodeId: authentication.recovery.recoveryCodeId,
      recoveryAuthIntentId: authentication.recovery.authIntentId,
      phishingResistantAt: null,
      recoveryVerifiedAt: now,
      recoveryRestricted: true,
    }
  }
  const recovery = 'recovery' in authentication ? authentication.recovery : undefined
  if (!recovery || !OPAQUE_ID.test(recovery.authIntentId)) {
    throw new TypeError('Authentication method requires database-bound recovery provenance')
  }
  return {
    authenticatorCredentialId: null,
    passwordCredentialId: null,
    passwordVerificationNonce: null,
    passkeyAuthIntentId: null,
    recoveryCodeId: null,
    recoveryAuthIntentId: recovery?.authIntentId ?? null,
    phishingResistantAt: null,
    recoveryVerifiedAt: recovery ? now : null,
    recoveryRestricted: Boolean(recovery),
  }
}

export async function createSessionDraft(input: CreateSessionDraftInput): Promise<SessionDraft> {
  const now = input.now ?? Date.now()
  if (
    !OPAQUE_ID.test(input.accountId) ||
    !validTimestamp(now) ||
    now > Number.MAX_SAFE_INTEGER - SESSION_ABSOLUTE_MS ||
    !DRAFT_AUTH_METHODS.has(input.authentication.method)
  ) {
    throw new TypeError('Invalid unified session input')
  }
  const provenance = sessionProvenance(input.authentication, now)
  const idleMs = provenance.recoveryRestricted ? RECOVERY_SESSION_IDLE_MS : SESSION_IDLE_MS
  const absoluteMs = provenance.recoveryRestricted
    ? RECOVERY_SESSION_ABSOLUTE_MS
    : SESSION_ABSOLUTE_MS
  const token = createOpaqueToken()
  const record: SessionDraft['record'] = Object.freeze({
    id: createOpaqueToken(),
    tokenHash: await hashOpaqueToken(token),
    accountId: input.accountId,
    authMethod: input.authentication.method,
    ...provenance,
    createdAt: now,
    lastSeenAt: now,
    idleExpiresAt: now + idleMs,
    absoluteExpiresAt: now + absoluteMs,
    authenticatedAt: now,
    displayMetadataJson: displayMetadataJson(input.displayMetadata),
  })
  const draft: SessionDraft = Object.freeze({
    token,
    record,
  })
  issuedSessionDrafts.add(draft)
  return draft
}

export function prepareSessionInsert(database: IdentityDatabase, draft: SessionDraft) {
  if (!issuedSessionDrafts.has(draft)) throw new TypeError('Session draft was not issued by kernel')
  const record = draft.record
  return database
    .prepare(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method,
         authenticator_credential_id, password_credential_id, password_verification_nonce,
         passkey_auth_intent_id, recovery_code_id,
         recovery_auth_intent_id, created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, authenticated_at, phishing_resistant_at,
         recovery_verified_at, recovery_restricted, display_metadata_json)
       SELECT ?, ?, account.id, account.security_version, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM identity_account AS account
       WHERE account.id = ? AND account.status = 'active'
         AND (? != 'password' OR EXISTS (
           SELECT 1 FROM identity_password_credential AS password
           WHERE password.id = ? AND password.account_id = account.id AND password.status = 'active'
             AND password.last_authenticated_at = ?
             AND password.write_nonce = ?
             AND (password.locked_until IS NULL OR password.locked_until <= ?)
         ))
       RETURNING id`,
    )
    .bind(
      record.id,
      record.tokenHash,
      record.authMethod,
      record.authenticatorCredentialId,
      record.passwordCredentialId,
      record.passwordVerificationNonce,
      record.passkeyAuthIntentId,
      record.recoveryCodeId,
      record.recoveryAuthIntentId,
      record.createdAt,
      record.lastSeenAt,
      record.idleExpiresAt,
      record.absoluteExpiresAt,
      record.authenticatedAt,
      record.phishingResistantAt,
      record.recoveryVerifiedAt,
      record.recoveryRestricted ? 1 : 0,
      record.displayMetadataJson,
      record.accountId,
      record.authMethod,
      record.passwordCredentialId,
      record.createdAt,
      record.passwordVerificationNonce,
      record.createdAt,
    )
}
