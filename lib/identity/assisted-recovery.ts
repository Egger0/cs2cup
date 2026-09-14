import 'server-only'

import { createOpaqueToken, hashOpaqueToken, isOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  replacementStatements,
  type RecoverySessionReplacement,
} from './internal/recovery-code-consumption.ts'
import { RECOVERY_INTENT_TTL_MS } from './internal/recovery-code-shared.ts'
import {
  roleAccessFailure,
  roleOperation,
  type RoleOperationOptions,
} from './internal/role-operator.ts'
import { securityEventStatement } from './internal/security-event.ts'
import { createSessionDraft, prepareSessionInsert } from './internal/session-draft.ts'
import { isCanonicalStoredUsername, normalizeUsername } from './internal/username-policy.ts'

export const ASSISTED_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000

export type AssistedRecoveryIssueResult =
  | { readonly ok: true; readonly secret: string; readonly expiresAt: number }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid_input'
        | 'reauthentication_required'
        | 'session_invalid'
        | 'forbidden'
        | 'not_found'
        | 'self_recovery'
        | 'conflict'
    }

export async function issueAssistedRecovery(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly username: string; readonly evidence: string },
  options: RoleOperationOptions = {},
): Promise<AssistedRecoveryIssueResult> {
  const { now, correlationId } = roleOperation(options)
  const username = normalizeUsername(input.username)
  const evidence = input.evidence.trim()
  if (!isCanonicalStoredUsername(username) || evidence.length < 10 || evidence.length > 2000) {
    return { ok: false, reason: 'invalid_input' }
  }
  const denied = await roleAccessFailure(database, context, now)
  if (denied) return { ok: false, reason: denied }
  const target = await database
    .prepare(
      `SELECT account.id FROM identity_password_credential AS credential
       JOIN identity_account AS account ON account.id = credential.account_id
       WHERE credential.username = ? AND credential.status = 'active'
         AND account.status = 'active' LIMIT 1`,
    )
    .bind(username)
    .first<{ id: string }>()
  if (!target) return { ok: false, reason: 'not_found' }
  if (target.id === context.account.id) return { ok: false, reason: 'self_recovery' }

  const caseId = createOpaqueToken()
  const reviewId = createOpaqueToken()
  const authorizationId = createOpaqueToken()
  const secret = createOpaqueToken()
  const receiptHash = await hashOpaqueToken(createOpaqueToken())
  const expiresAt = now + ASSISTED_RECOVERY_TTL_MS
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_assisted_recovery_case
            (id, account_id, receipt_hash, evidence_statement, requested_at, not_before_at,
             expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(caseId, target.id, receiptHash, evidence, now, now, expiresAt),
      database
        .prepare(
          `INSERT INTO identity_assisted_recovery_review
            (id, case_id, reviewer_account_id, reviewer_session_id, decision, reason,
             decided_at, request_correlation_id)
           VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`,
        )
        .bind(
          reviewId,
          caseId,
          context.account.id,
          context.session.id,
          evidence,
          now,
          correlationId,
        ),
      database
        .prepare(
          `UPDATE identity_assisted_recovery_case
           SET status = 'approved', review_id = ?, reviewed_at = ?, revision = revision + 1,
               write_nonce = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .bind(reviewId, now, createOpaqueToken(), caseId),
      database
        .prepare(
          `INSERT INTO identity_assisted_recovery_authorization
            (id, case_id, receipt_hash, secret_hash, issued_at, not_before_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          authorizationId,
          caseId,
          receiptHash,
          await hashOpaqueToken(secret),
          now,
          now,
          expiresAt,
        ),
      await securityEventStatement(database, {
        eventType: 'account.assisted_recovery.issued',
        severity: 'warning',
        actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
        targetAccountId: target.id,
        resource: { type: 'account', id: target.id },
        correlationId,
        deduplicationScope: `assisted-recovery-issued:${caseId}`,
        details: { caseId, reason: evidence },
        retentionClass: 'access_control',
        createdAt: now,
      }),
    ])
  } catch (error) {
    if (
      error instanceof Error &&
      /(?:assisted recovery|recovery authorization)/i.test(error.message)
    ) {
      return { ok: false, reason: 'conflict' }
    }
    throw error
  }
  return { ok: true, secret, expiresAt }
}

interface AuthorizationRow {
  id: string
  case_id: string
  account_id: string
}

export async function consumeAssistedRecovery(
  database: IdentityDatabase,
  input: { readonly secret: unknown; readonly clientLabel?: string },
  now = Date.now(),
  replacement: RecoverySessionReplacement = {},
) {
  if (typeof input.secret !== 'string' || !isOpaqueToken(input.secret)) {
    return { ok: false, reason: 'invalid_link' } as const
  }
  const secretHash = await hashOpaqueToken(input.secret)
  const live = `authorization.secret_hash = ? AND authorization.consumed_at IS NULL
    AND authorization.not_before_at <= ? AND authorization.expires_at > ?
    AND NOT EXISTS (
      SELECT 1 FROM identity_password_change AS password_change
      JOIN identity_assisted_recovery_case AS changed_case
        ON changed_case.account_id = password_change.account_id
      WHERE changed_case.id = authorization.case_id
        AND password_change.changed_at >= authorization.issued_at
    )`
  const target = await database
    .prepare(
      `SELECT authorization.id, authorization.case_id, recovery_case.account_id
       FROM identity_assisted_recovery_authorization AS authorization
       JOIN identity_assisted_recovery_case AS recovery_case
         ON recovery_case.id = authorization.case_id
       JOIN identity_account AS account ON account.id = recovery_case.account_id
       JOIN identity_password_credential AS credential ON credential.account_id = account.id
       WHERE ${live} AND recovery_case.status = 'approved'
         AND account.status = 'active' AND credential.status = 'active'
       LIMIT 1`,
    )
    .bind(secretHash, now, now)
    .first<AuthorizationRow>()
  if (!target) return { ok: false, reason: 'invalid_link' } as const

  const intentId = createOpaqueToken()
  const draft = await createSessionDraft({
    accountId: target.account_id,
    authentication: { method: 'assisted_recovery', recovery: { authIntentId: intentId } },
    displayMetadata: {
      recovery: true,
      ...(input.clientLabel ? { clientLabel: input.clientLabel } : {}),
    },
    now,
  })
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_auth_intent
            (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
             idempotency_key, max_attempts, created_at, expires_at)
           VALUES (?, ?, 'recovery', ?, 'account_security', ?, ?, 1, ?, ?)`,
        )
        .bind(
          intentId,
          await hashOpaqueToken(createOpaqueToken()),
          target.account_id,
          createOpaqueToken(),
          await hashOpaqueToken(createOpaqueToken()),
          now,
          now + RECOVERY_INTENT_TTL_MS,
        ),
      database
        .prepare(
          `UPDATE identity_assisted_recovery_authorization AS authorization
           SET consumed_auth_intent_id = ?, consumed_at = ?, consume_nonce = ?
           WHERE authorization.id = ? AND ${live}`,
        )
        .bind(intentId, now, createOpaqueToken(), target.id, secretHash, now, now),
      database
        .prepare(
          `UPDATE identity_auth_intent
           SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'assisted_recovery',
               completion_result_ref = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND purpose = 'recovery' AND consumed_at IS NULL`,
        )
        .bind(now, createOpaqueToken(), target.id, createOpaqueToken(), intentId),
      database
        .prepare(
          `UPDATE identity_assisted_recovery_case
           SET status = 'consumed', consumed_at = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND status = 'approved'`,
        )
        .bind(now, createOpaqueToken(), target.case_id),
      prepareSessionInsert(database, draft),
      await securityEventStatement(database, {
        eventType: 'account.assisted_recovery.used',
        severity: 'warning',
        actor: { type: 'account', accountId: target.account_id, sessionId: draft.record.id },
        targetAccountId: target.account_id,
        resource: { type: 'account', id: target.account_id },
        correlationId: draft.record.id,
        deduplicationScope: `assisted-recovery-used:${target.case_id}`,
        details: { caseId: target.case_id },
        createdAt: now,
      }),
      ...replacementStatements(database, replacement, now),
    ])
  } catch {
    return { ok: false, reason: 'conflict' } as const
  }
  const inserted = await database
    .prepare('SELECT 1 AS present FROM identity_session WHERE id = ? AND token_hash = ? LIMIT 1')
    .bind(draft.record.id, draft.record.tokenHash)
    .first<{ present: number }>()
  if (!inserted) return { ok: false, reason: 'conflict' } as const
  return {
    ok: true,
    token: draft.token,
    absoluteExpiresAt: draft.record.absoluteExpiresAt,
  } as const
}
