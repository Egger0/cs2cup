import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { IdentityDatabase, IdentityStatement } from './contracts.ts'
import type { ClaimedPasskeyIntent } from './passkey-intent.ts'
import {
  exactPasskeyTime,
  IdentityPasskeyError,
  validCounter,
  validDeviceType,
} from './passkey-shared.ts'
import { createSessionDraft, prepareSessionInsert } from './session-draft.ts'
import {
  prepareVerifiedPasskeyCredential,
  type PasskeyAuthenticationCredential,
  type PasskeyVerificationCredential,
} from './passkey-authentication-credential.ts'

export {
  passkeyAuthenticationCredential,
  type PasskeyAuthenticationCredential,
  type PasskeyVerificationCredential,
} from './passkey-authentication-credential.ts'

export interface PasskeySessionReplacement {
  readonly unifiedTokenHash?: string | null
  readonly legacyAdminTokenHash?: string | null
  readonly legacyParticipantTokenHash?: string | null
}

const HASH = /^[0-9a-f]{64}$/

function optionalHash(value: string | null | undefined) {
  return value === undefined || value === null || HASH.test(value)
}

function replacementStatements(
  database: IdentityDatabase,
  replacement: PasskeySessionReplacement,
  now: number,
) {
  if (
    !optionalHash(replacement.unifiedTokenHash) ||
    !optionalHash(replacement.legacyAdminTokenHash) ||
    !optionalHash(replacement.legacyParticipantTokenHash)
  ) {
    throw new IdentityPasskeyError('invalid_request')
  }
  const statements: IdentityStatement[] = []
  if (replacement.unifiedTokenHash) {
    statements.push(
      database
        .prepare(
          `UPDATE identity_session
           SET revoked_at = ?, revoke_reason = 'replaced_by_passkey_sign_in',
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

async function signedInAuditStatement(
  database: IdentityDatabase,
  input: { accountId: string; sessionId: string; intentId: string; now: number },
) {
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, request_correlation_id, deduplication_key,
         details_json, retention_class, created_at)
       VALUES (?, 'account.signed_in', 'info', 'account',
         (SELECT account_id FROM identity_session
          WHERE id = ? AND account_id = ? AND passkey_auth_intent_id = ?),
         ?, ?, 'platform', ?, ?, ?, 'account_security', ?)`,
    )
    .bind(
      createOpaqueToken(),
      input.sessionId,
      input.accountId,
      input.intentId,
      input.accountId,
      input.sessionId,
      input.sessionId,
      await hashOpaqueToken(`passkey-sign-in\0${input.sessionId}`),
      JSON.stringify({ method: 'passkey' }),
      input.now,
    )
}

export interface VerifiedPasskeyAuthentication {
  readonly newCounter: number
  readonly deviceType: 'singleDevice' | 'multiDevice'
  readonly backedUp: boolean
}

interface PasskeyCompletionInput {
  intent: ClaimedPasskeyIntent
  credential: PasskeyAuthenticationCredential
  verification: VerifiedPasskeyAuthentication
  replacement?: PasskeySessionReplacement
  clientLabel?: string
  now: number
}

async function completePasskeyAuthenticationBatch(
  database: IdentityDatabase,
  input: PasskeyCompletionInput,
  prefix: readonly IdentityStatement[],
) {
  const now = exactPasskeyTime(input.now)
  if (
    input.intent.purpose !== 'passkey_sign_in' ||
    now >= input.intent.expiresAt ||
    (input.intent.expectedAccountId !== null &&
      input.intent.expectedAccountId !== input.credential.accountId) ||
    !validCounter(input.verification.newCounter) ||
    input.verification.newCounter < input.credential.counter ||
    !validDeviceType(input.verification.deviceType)
  ) {
    throw new IdentityPasskeyError('conflict')
  }
  const credentialNonce = createOpaqueToken()
  const consumeNonce = createOpaqueToken()
  const intentNonce = createOpaqueToken()
  const nextCredentialRevision = input.credential.revision + 1
  const draft = await createSessionDraft({
    accountId: input.credential.accountId,
    authentication: {
      method: 'passkey',
      authenticatorCredentialId: input.credential.id,
      authIntentId: input.intent.id,
    },
    displayMetadata: input.clientLabel ? { clientLabel: input.clientLabel } : undefined,
    now,
  })
  const credentialUpdate = database
    .prepare(
      `UPDATE identity_passkey_credential
       SET counter = ?, device_type = ?, backed_up = ?, last_used_at = ?,
           revision = revision + 1, write_nonce = ?
       WHERE credential_id = ? AND account_id = ? AND status = 'active'
         AND counter = ? AND revision = ?`,
    )
    .bind(
      input.verification.newCounter,
      input.verification.deviceType,
      input.verification.backedUp ? 1 : 0,
      now,
      credentialNonce,
      input.credential.id,
      input.credential.accountId,
      input.credential.counter,
      input.credential.revision,
    )
  const intentConsume = database
    .prepare(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'passkey_credential',
           completion_result_ref = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND purpose = 'passkey_sign_in' AND secret_hash = ?
         AND passkey_challenge_hash = ? AND revision = ? AND attempt_count = ?
         AND consumed_at IS NULL AND expires_at > ?
         AND (expected_account_id IS NULL OR expected_account_id = ?)
         AND EXISTS (
           SELECT 1 FROM identity_passkey_credential AS credential
           WHERE credential.credential_id = ? AND credential.account_id = ?
             AND credential.status = 'active' AND credential.counter = ?
             AND credential.last_used_at = ? AND credential.revision = ?
             AND credential.write_nonce = ?
         )`,
    )
    .bind(
      now,
      consumeNonce,
      input.credential.id,
      intentNonce,
      input.intent.id,
      input.intent.secretHash,
      input.intent.challengeHash,
      input.intent.revision,
      input.intent.attemptCount,
      now,
      input.credential.accountId,
      input.credential.id,
      input.credential.accountId,
      input.verification.newCounter,
      now,
      nextCredentialRevision,
      credentialNonce,
    )
  try {
    await database.batch([
      ...prefix,
      credentialUpdate,
      intentConsume,
      prepareSessionInsert(database, draft),
      await signedInAuditStatement(database, {
        accountId: input.credential.accountId,
        sessionId: draft.record.id,
        intentId: input.intent.id,
        now,
      }),
      ...replacementStatements(database, input.replacement ?? {}, now),
    ])
  } catch (error) {
    if (error instanceof IdentityPasskeyError) throw error
    if (
      error instanceof Error &&
      /(?:conflict|constraint|unique|foreign key|requires|mismatch)/i.test(error.message)
    ) {
      throw new IdentityPasskeyError('conflict')
    }
    throw error
  }
  return {
    token: draft.token,
    sessionId: draft.record.id,
    accountId: input.credential.accountId,
    absoluteExpiresAt: draft.record.absoluteExpiresAt,
    redirectKey: input.intent.redirectKey,
    redirectContext: input.intent.context,
  }
}

export function completePasskeyAuthentication(
  database: IdentityDatabase,
  input: PasskeyCompletionInput,
) {
  return completePasskeyAuthenticationBatch(database, input, [])
}

export async function completeVerifiedPasskeyAuthentication(
  database: IdentityDatabase,
  input: Omit<PasskeyCompletionInput, 'credential'> & {
    credential: PasskeyVerificationCredential
  },
) {
  const prepared = await prepareVerifiedPasskeyCredential(database, input.credential, input.now)
  const completion = { ...input, credential: prepared.credential }
  try {
    return await completePasskeyAuthenticationBatch(
      database,
      completion,
      prepared.migrationStatements,
    )
  } catch (error) {
    if (prepared.migrationStatements.length === 0) throw error
    const raced = await prepareVerifiedPasskeyCredential(database, input.credential, input.now)
    if (raced.migrationStatements.length !== 0) throw error
    return completePasskeyAuthenticationBatch(
      database,
      { ...input, credential: raced.credential },
      [],
    )
  }
}
