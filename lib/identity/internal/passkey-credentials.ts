import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import {
  exactPasskeyTime,
  IdentityPasskeyError,
  validCounter,
  validDeviceType,
  validPasskeyCredentialId,
} from './passkey-shared.ts'
import { hasRecentAuthentication, RECENT_AUTHENTICATION_MS } from './recent-authentication.ts'
import { privateSessionContext } from './session-context.ts'

export interface AccountPasskey {
  readonly credentialId: string
  readonly label: string
  readonly deviceType: 'singleDevice' | 'multiDevice'
  readonly backedUp: boolean
  readonly createdAt: number
  readonly lastUsedAt: number | null
}

interface PasskeyRow {
  credential_id: string
  label: string | null
  device_type: 'singleDevice' | 'multiDevice'
  backed_up: number
  created_at: number
  last_used_at: number | null
  revision: number
}

interface RevocablePasskeyRow extends PasskeyRow {
  active_passkey_count: number
  has_password: number
}

function validTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function accountPasskey(row: PasskeyRow): AccountPasskey {
  if (
    !validPasskeyCredentialId(row.credential_id) ||
    (row.label !== null &&
      (typeof row.label !== 'string' || !row.label || row.label !== row.label.trim())) ||
    !validDeviceType(row.device_type) ||
    ![0, 1].includes(row.backed_up) ||
    !validTime(row.created_at) ||
    (row.last_used_at !== null && !validTime(row.last_used_at)) ||
    !validCounter(row.revision)
  ) {
    throw new IdentityPasskeyError('conflict')
  }
  return Object.freeze({
    credentialId: row.credential_id,
    label: row.label ?? '未命名 Passkey',
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  })
}

function currentSessionWhere() {
  return `session.id = ? AND session.account_id = ? AND session.token_hash = ?
    AND session.revoked_at IS NULL AND session.recovery_restricted = 0
    AND session.security_version = account.security_version AND account.status = 'active'
    AND session.idle_expires_at > ? AND session.absolute_expires_at > ?`
}

export async function listAccountPasskeys(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  exactPasskeyTime(now)
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new IdentityPasskeyError('not_authenticated')
  if (context.session.recoveryRestricted) throw new IdentityPasskeyError('recovery_restricted')
  const rows = await database
    .prepare(
      `SELECT credential.credential_id, credential.label, credential.device_type,
              credential.backed_up, credential.created_at, credential.last_used_at,
              credential.revision
       FROM identity_passkey_credential AS credential
       JOIN identity_account AS account ON account.id = credential.account_id
       JOIN identity_session AS session ON session.account_id = account.id
       WHERE credential.account_id = ? AND credential.status = 'active'
         AND ${currentSessionWhere()}
       ORDER BY credential.created_at, credential.credential_id`,
    )
    .bind(
      context.account.id,
      context.session.id,
      context.account.id,
      privateContext.tokenHash,
      now,
      now,
    )
    .all<PasskeyRow>()
  if (!rows.results.length) {
    const current = await database
      .prepare(
        `SELECT 1 AS current FROM identity_session AS session
         JOIN identity_account AS account ON account.id = session.account_id
         WHERE ${currentSessionWhere()} LIMIT 1`,
      )
      .bind(context.session.id, context.account.id, privateContext.tokenHash, now, now)
      .first<{ current: number }>()
    if (!current) throw new IdentityPasskeyError('not_authenticated')
  }
  return Object.freeze(rows.results.map(accountPasskey))
}

async function revokedAuditStatement(
  database: IdentityDatabase,
  input: {
    accountId: string
    sessionId: string
    credentialId: string
    credentialNonce: string
    accountNonce: string
    now: number
  },
) {
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       VALUES (?, 'account.passkey.revoked', 'warning', 'account',
         (SELECT account.id FROM identity_account AS account
          JOIN identity_passkey_credential AS credential ON credential.account_id = account.id
          WHERE account.id = ? AND account.write_nonce = ?
            AND credential.credential_id = ? AND credential.status = 'revoked'
            AND credential.write_nonce = ?
            AND NOT EXISTS (SELECT 1 FROM identity_session AS active_session
              WHERE active_session.account_id = account.id AND active_session.revoked_at IS NULL
                AND active_session.security_version < account.security_version)),
         ?, ?, 'account', ?, ?, ?, ?, 'account_security', ?)`,
    )
    .bind(
      createOpaqueToken(),
      input.accountId,
      input.accountNonce,
      input.credentialId,
      input.credentialNonce,
      input.accountId,
      input.sessionId,
      input.accountId,
      input.sessionId,
      await hashOpaqueToken(`passkey-revoked\0${input.credentialId}\0${input.now}`),
      JSON.stringify({ credentialId: input.credentialId, sessionsRevoked: true }),
      input.now,
    )
}

export async function revokeAccountPasskey(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  credentialId: string,
  now = Date.now(),
) {
  exactPasskeyTime(now)
  if (!validPasskeyCredentialId(credentialId)) {
    throw new IdentityPasskeyError('invalid_request')
  }
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new IdentityPasskeyError('not_authenticated')
  if (context.session.recoveryRestricted) throw new IdentityPasskeyError('recovery_restricted')
  if (!hasRecentAuthentication(context, now)) {
    throw new IdentityPasskeyError('reauth_required')
  }
  const credential = await database
    .prepare(
      `SELECT credential.credential_id, credential.label, credential.device_type,
              credential.backed_up, credential.created_at, credential.last_used_at,
              credential.revision,
              (SELECT COUNT(*) FROM identity_passkey_credential AS active_passkey
               WHERE active_passkey.account_id = credential.account_id
                 AND active_passkey.status = 'active') AS active_passkey_count,
              EXISTS(SELECT 1 FROM identity_password_credential AS password
                     WHERE password.account_id = credential.account_id
                       AND password.status = 'active') AS has_password
       FROM identity_passkey_credential AS credential
       JOIN identity_session AS session ON session.account_id = credential.account_id
       JOIN identity_account AS account ON account.id = credential.account_id
       WHERE credential.credential_id = ? AND credential.account_id = ?
         AND credential.status = 'active' AND ${currentSessionWhere()} LIMIT 1`,
    )
    .bind(
      credentialId,
      context.account.id,
      context.session.id,
      context.account.id,
      privateContext.tokenHash,
      now,
      now,
    )
    .first<RevocablePasskeyRow>()
  if (!credential) throw new IdentityPasskeyError('not_found')
  accountPasskey(credential)
  if (Number(credential.active_passkey_count) <= 1 && credential.has_password !== 1) {
    throw new IdentityPasskeyError('last_credential')
  }
  const credentialNonce = createOpaqueToken()
  const accountNonce = createOpaqueToken()
  const credentialUpdate = database
    .prepare(
      `UPDATE identity_passkey_credential
       SET status = 'revoked', revoked_at = ?, revision = revision + 1, write_nonce = ?
       WHERE credential_id = ? AND account_id = ? AND status = 'active' AND revision = ?`,
    )
    .bind(now, credentialNonce, credentialId, context.account.id, credential.revision)
  const accountUpdate = database
    .prepare(
      `UPDATE identity_account
       SET security_version = security_version + 1, updated_at = ?,
           revision = revision + 1, write_nonce = ?
       WHERE id = ? AND status = 'active' AND EXISTS (
         SELECT 1 FROM identity_passkey_credential AS credential
         WHERE credential.credential_id = ? AND credential.account_id = identity_account.id
           AND credential.status = 'revoked' AND credential.write_nonce = ?
       ) AND EXISTS (
         SELECT 1 FROM identity_session AS authorizing_session
         WHERE authorizing_session.id = ? AND authorizing_session.account_id = identity_account.id
           AND authorizing_session.token_hash = ? AND authorizing_session.revoked_at IS NULL
           AND authorizing_session.recovery_restricted = 0
           AND authorizing_session.security_version = identity_account.security_version
           AND authorizing_session.authenticated_at >= ?
           AND authorizing_session.idle_expires_at > ?
           AND authorizing_session.absolute_expires_at > ?
       )`,
    )
    .bind(
      now,
      accountNonce,
      context.account.id,
      credentialId,
      credentialNonce,
      context.session.id,
      privateContext.tokenHash,
      now - RECENT_AUTHENTICATION_MS,
      now,
      now,
    )
  try {
    await database.batch([
      credentialUpdate,
      accountUpdate,
      await revokedAuditStatement(database, {
        accountId: context.account.id,
        sessionId: context.session.id,
        credentialId,
        credentialNonce,
        accountNonce,
        now,
      }),
    ])
  } catch (error) {
    if (error instanceof Error && /last login credential/i.test(error.message)) {
      throw new IdentityPasskeyError('last_credential')
    }
    if (
      error instanceof Error &&
      /(?:conflict|constraint|unique|foreign key|requires|mismatch)/i.test(error.message)
    ) {
      throw new IdentityPasskeyError('conflict')
    }
    throw error
  }
  return { revoked: true, sessionsRevoked: true } as const
}
