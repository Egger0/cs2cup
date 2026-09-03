import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import {
  claimPasskeyIntentAttempt,
  issuePasskeyIntent,
  type ClaimedPasskeyIntent,
} from './passkey-intent.ts'
import {
  byteView,
  exactPasskeyTime,
  IdentityPasskeyError,
  passkeyLabel,
  passkeyTransports,
  validCounter,
  validDeviceType,
  validOpaqueId,
  validPasskeyCredentialId,
} from './passkey-shared.ts'
import { privateSessionContext } from './session-context.ts'

interface EnrollmentAccountRow {
  id: string
  webauthn_user_handle: string
  display_name: string
  account_label: string
}

interface CredentialIdRow {
  credential_id: string
}

async function enrollmentAccount(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new IdentityPasskeyError('not_authenticated')
  if (context.session.recoveryRestricted) throw new IdentityPasskeyError('recovery_restricted')
  const row = await database
    .prepare(
      `SELECT account.id, account.webauthn_user_handle, account.display_name,
              COALESCE((SELECT password.username FROM identity_password_credential AS password
                        WHERE password.account_id = account.id AND password.status = 'active'
                        LIMIT 1), account.display_name) AS account_label
       FROM identity_session AS session
       JOIN identity_account AS account ON account.id = session.account_id
       WHERE session.id = ? AND session.account_id = ? AND session.token_hash = ?
         AND session.revoked_at IS NULL AND session.recovery_restricted = 0
         AND session.security_version = account.security_version AND account.status = 'active'
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ? LIMIT 1`,
    )
    .bind(context.session.id, context.account.id, privateContext.tokenHash, now, now)
    .first<EnrollmentAccountRow>()
  if (
    !row ||
    row.id !== context.account.id ||
    !validOpaqueId(row.webauthn_user_handle) ||
    typeof row.display_name !== 'string' ||
    !row.display_name ||
    typeof row.account_label !== 'string' ||
    !row.account_label
  ) {
    throw new IdentityPasskeyError('not_authenticated')
  }
  return row
}

export async function preparePasskeyEnrollment(
  database: IdentityDatabase,
  input: { context: AuthenticatedAuthContext; label?: unknown; now: number },
) {
  const now = exactPasskeyTime(input.now)
  const label = passkeyLabel(input.label)
  const account = await enrollmentAccount(database, input.context, now)
  const existing = await database
    .prepare(
      `SELECT credential_id FROM identity_passkey_credential
       WHERE account_id = ? AND status = 'active' ORDER BY created_at, credential_id`,
    )
    .bind(account.id)
    .all<CredentialIdRow>()
  if (existing.results.some(row => !validPasskeyCredentialId(row.credential_id))) {
    throw new IdentityPasskeyError('conflict')
  }
  const intent = await issuePasskeyIntent(database, {
    purpose: 'passkey_enrollment',
    authenticatedContext: input.context,
    redirectKey: 'account_security',
    context: { label },
    now,
  })
  return {
    intent,
    userHandle: account.webauthn_user_handle,
    accountLabel: account.account_label,
    displayLabel: account.display_name,
    excludeCredentialIds: existing.results.map(row => row.credential_id),
  }
}

export function claimPasskeyEnrollmentAttempt(
  database: IdentityDatabase,
  input: { context: AuthenticatedAuthContext; secret: string; now: number },
) {
  return claimPasskeyIntentAttempt(database, {
    purpose: 'passkey_enrollment',
    authenticatedContext: input.context,
    secret: input.secret,
    now: input.now,
  })
}

export interface VerifiedPasskeyRegistration {
  readonly credential: {
    readonly id: string
    readonly publicKey: ArrayBuffer | Uint8Array
    readonly counter: number
    readonly transports: readonly string[]
  }
  readonly deviceType: 'singleDevice' | 'multiDevice'
  readonly backedUp: boolean
}

async function enrollmentAuditStatement(
  database: IdentityDatabase,
  input: {
    intentId: string
    consumeNonce: string
    accountId: string
    sessionId: string
    credentialId: string
    now: number
  },
) {
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       VALUES (?, 'account.passkey.enrolled', 'info', 'account',
         (SELECT expected_account_id FROM identity_auth_intent
          WHERE id = ? AND consumed_at = ? AND consume_nonce = ?
            AND completion_result_ref = ?),
         ?, ?, 'account', ?, ?, ?, ?, 'account_security', ?)`,
    )
    .bind(
      createOpaqueToken(),
      input.intentId,
      input.now,
      input.consumeNonce,
      input.credentialId,
      input.accountId,
      input.sessionId,
      input.accountId,
      input.sessionId,
      await hashOpaqueToken(`passkey-enrolled\0${input.intentId}`),
      JSON.stringify({ credentialId: input.credentialId }),
      input.now,
    )
}

export async function completePasskeyEnrollment(
  database: IdentityDatabase,
  input: {
    context: AuthenticatedAuthContext
    intent: ClaimedPasskeyIntent
    registration: VerifiedPasskeyRegistration
    now: number
  },
) {
  const now = exactPasskeyTime(input.now)
  const privateContext = privateSessionContext(input.context)
  const credential = input.registration.credential
  if (
    !privateContext ||
    input.context.session.recoveryRestricted ||
    input.intent.purpose !== 'passkey_enrollment' ||
    input.intent.expectedAccountId !== input.context.account.id ||
    now >= input.intent.expiresAt ||
    !validPasskeyCredentialId(credential.id) ||
    !validCounter(credential.counter) ||
    !validDeviceType(input.registration.deviceType)
  ) {
    throw new IdentityPasskeyError('conflict')
  }
  const publicKey = byteView(credential.publicKey)
  const transports = passkeyTransports(credential.transports)
  const label = passkeyLabel(input.intent.context.label)
  const credentialNonce = createOpaqueToken()
  const consumeNonce = createOpaqueToken()
  const intentNonce = createOpaqueToken()
  const credentialInsert = database
    .prepare(
      `INSERT INTO identity_passkey_credential
        (credential_id, account_id, registration_kind, registration_auth_intent_id,
         public_key, counter, transports_json, device_type, backed_up, label, status,
         created_at, revision, write_nonce)
       SELECT ?, intent.expected_account_id, 'ceremony', intent.id, ?, ?, ?, ?, ?, ?,
              'active', ?, 0, ?
       FROM identity_auth_intent AS intent
       JOIN identity_passkey_enrollment_authorization AS authorization
         ON authorization.auth_intent_id = intent.id
        AND authorization.account_id = intent.expected_account_id
       JOIN identity_session AS session ON session.id = authorization.initiating_session_id
       JOIN identity_account AS account ON account.id = authorization.account_id
       WHERE intent.id = ? AND intent.purpose = 'passkey_enrollment'
         AND intent.secret_hash = ? AND intent.passkey_challenge_hash = ?
         AND intent.revision = ? AND intent.attempt_count = ? AND intent.consumed_at IS NULL
         AND intent.expires_at > ? AND authorization.initiating_session_id = ?
         AND session.account_id = ? AND session.token_hash = ? AND session.revoked_at IS NULL
         AND session.recovery_restricted = 0 AND session.security_version = account.security_version
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         AND account.status = 'active'`,
    )
    .bind(
      credential.id,
      publicKey,
      credential.counter,
      JSON.stringify(transports),
      input.registration.deviceType,
      input.registration.backedUp ? 1 : 0,
      label,
      now,
      credentialNonce,
      input.intent.id,
      input.intent.secretHash,
      input.intent.challengeHash,
      input.intent.revision,
      input.intent.attemptCount,
      now,
      input.context.session.id,
      input.context.account.id,
      privateContext.tokenHash,
      now,
      now,
    )
  const intentConsume = database
    .prepare(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'passkey_credential',
           completion_result_ref = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND purpose = 'passkey_enrollment' AND secret_hash = ?
         AND passkey_challenge_hash = ? AND revision = ? AND attempt_count = ?
         AND consumed_at IS NULL AND expires_at > ? AND expected_account_id = ?
         AND EXISTS (
           SELECT 1 FROM identity_passkey_credential AS credential
           WHERE credential.credential_id = ? AND credential.account_id = ?
             AND credential.registration_auth_intent_id = identity_auth_intent.id
             AND credential.status = 'active' AND credential.write_nonce = ?
         )`,
    )
    .bind(
      now,
      consumeNonce,
      credential.id,
      intentNonce,
      input.intent.id,
      input.intent.secretHash,
      input.intent.challengeHash,
      input.intent.revision,
      input.intent.attemptCount,
      now,
      input.context.account.id,
      credential.id,
      input.context.account.id,
      credentialNonce,
    )
  try {
    await database.batch([
      credentialInsert,
      intentConsume,
      await enrollmentAuditStatement(database, {
        intentId: input.intent.id,
        consumeNonce,
        accountId: input.context.account.id,
        sessionId: input.context.session.id,
        credentialId: credential.id,
        now,
      }),
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
    credentialId: credential.id,
    label: label ?? '未命名 Passkey',
    deviceType: input.registration.deviceType,
    backedUp: input.registration.backedUp,
    createdAt: now,
    lastUsedAt: null,
  } as const
}
