import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type {
  AuthenticatedAuthContext,
  IdentityDatabase,
  IdentityStatement,
} from '../internal/contracts.ts'
import { privateSessionContext } from '../internal/session-context.ts'
import { REGISTRATION_RECENT_AUTH_MS } from './shared.ts'
import type { InvitationRow } from './types.ts'
import { RegistrationWorkflowError } from './types.ts'

export const ACTIVE_INVITATION_ACCEPTOR = `EXISTS (
  SELECT 1 FROM identity_session AS accepting_session
  JOIN identity_account AS accepting_account
    ON accepting_account.id = accepting_session.account_id
  WHERE accepting_session.id = ? AND accepting_session.account_id = ?
    AND accepting_session.token_hash = ?
    AND accepting_session.security_version = accepting_account.security_version
    AND accepting_session.revoked_at IS NULL
    AND accepting_session.recovery_restricted = 0
    AND accepting_session.auth_method IN ('passkey', 'password')
    AND accepting_session.created_at <= ? AND accepting_session.last_seen_at <= ?
    AND accepting_session.idle_expires_at > ? AND accepting_session.absolute_expires_at > ?
    AND accepting_session.authenticated_at >= ? AND accepting_session.authenticated_at <= ?
    AND accepting_account.status = 'active'
)`

export function invitationAcceptorProof(
  context: AuthenticatedAuthContext,
  now: number,
  recentAuthentication: boolean,
) {
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new RegistrationWorkflowError('reauth_required')
  return [
    context.session.id,
    context.account.id,
    privateContext.tokenHash,
    now,
    now,
    now,
    now,
    recentAuthentication ? now - REGISTRATION_RECENT_AUTH_MS : 0,
    now,
  ]
}

interface AcceptanceAuditInput {
  readonly context: AuthenticatedAuthContext
  readonly invitation: InvitationRow
  readonly now: number
  readonly acceptanceNonce: string
  readonly membershipId: string
  readonly membershipNonce: string
  readonly oldOwnerRevocationNonce: string
  readonly promotedManager: { readonly id: string; readonly nonce: string } | null
  readonly grantReason: string
  readonly sessionProof: readonly unknown[]
}

export async function acceptanceAuditStatement(
  database: IdentityDatabase,
  input: AcceptanceAuditInput,
): Promise<{ id: string; type: string; statement: IdentityStatement }> {
  const transfer = input.invitation.relationship === 'owner'
  const id = createOpaqueToken()
  const type = transfer
    ? 'registration.access.ownership_transferred'
    : 'registration.access.manager_accepted'
  const oldOwnerProof = transfer
    ? `AND EXISTS (
        SELECT 1 FROM identity_registration_membership AS previous_owner
        WHERE previous_owner.team_id = invitation.team_id
          AND previous_owner.account_id = invitation.inviter_account_id
          AND previous_owner.relationship = 'owner'
          AND previous_owner.revoked_at = ?
          AND previous_owner.revoked_by_account_id = invitation.invited_account_id
          AND previous_owner.revoke_reason = 'Accepted ownership transfer'
          AND previous_owner.write_nonce = ?
      )`
    : ''
  const promotedManagerProof = input.promotedManager
    ? `AND EXISTS (
        SELECT 1 FROM identity_registration_membership AS previous_manager
        WHERE previous_manager.id = ?
          AND previous_manager.team_id = invitation.team_id
          AND previous_manager.account_id = invitation.invited_account_id
          AND previous_manager.relationship = 'manager'
          AND previous_manager.revoked_at = ?
          AND previous_manager.revoked_by_account_id = invitation.invited_account_id
          AND previous_manager.revoke_reason = 'Promoted to registration owner'
          AND previous_manager.write_nonce = ?
      )`
    : ''
  const targetAccountId = transfer ? input.invitation.inviter_account_id : input.context.account.id
  const details = transfer
    ? {
        invitationId: input.invitation.id,
        membershipId: input.membershipId,
        previousOwnerAccountId: input.invitation.inviter_account_id,
        newOwnerAccountId: input.context.account.id,
        relationship: input.invitation.relationship,
      }
    : {
        invitationId: input.invitation.id,
        membershipId: input.membershipId,
        ownerAccountId: input.invitation.inviter_account_id,
        managerAccountId: input.context.account.id,
        relationship: input.invitation.relationship,
      }
  const statement = database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       VALUES (
         CASE WHEN EXISTS (
           SELECT 1 FROM identity_registration_invitation AS invitation
           JOIN identity_registration_membership AS accepted_membership
             ON accepted_membership.id = ?
            AND accepted_membership.team_id = invitation.team_id
            AND accepted_membership.account_id = invitation.invited_account_id
            AND accepted_membership.relationship = invitation.relationship
            AND accepted_membership.granted_by_account_id = invitation.inviter_account_id
            AND accepted_membership.grant_reason = ?
            AND accepted_membership.granted_at = ?
            AND accepted_membership.revoked_at IS NULL
            AND accepted_membership.write_nonce = ?
           WHERE invitation.id = ? AND invitation.team_id = ?
             AND invitation.invited_account_id = ?
             AND invitation.inviter_account_id = ?
             AND invitation.relationship = ?
             AND invitation.accepted_at = ? AND invitation.write_nonce = ?
             ${oldOwnerProof}
             ${promotedManagerProof}
             AND ${ACTIVE_INVITATION_ACCEPTOR}
         ) THEN ? ELSE NULL END,
         ?, 'info', 'account', ?, ?, ?, 'registration', ?, ?, ?, ?,
         'access_control', ?
       )`,
    )
    .bind(
      input.membershipId,
      input.grantReason,
      input.now,
      input.membershipNonce,
      input.invitation.id,
      input.invitation.team_id,
      input.context.account.id,
      input.invitation.inviter_account_id,
      input.invitation.relationship,
      input.now,
      input.acceptanceNonce,
      ...(transfer ? [input.now, input.oldOwnerRevocationNonce] : []),
      ...(input.promotedManager
        ? [input.promotedManager.id, input.now, input.promotedManager.nonce]
        : []),
      ...input.sessionProof,
      id,
      type,
      input.context.account.id,
      targetAccountId,
      input.context.session.id,
      String(input.invitation.team_id),
      input.acceptanceNonce,
      await hashOpaqueToken(`registration-invitation-accepted\0${input.invitation.id}`),
      JSON.stringify(details),
      input.now,
    )
  return { id, type, statement }
}

export async function acceptanceRecorded(
  database: IdentityDatabase,
  input: {
    readonly eventId: string
    readonly eventType: string
    readonly membershipId: string
    readonly teamId: number
    readonly context: AuthenticatedAuthContext
  },
) {
  return database
    .prepare(
      `SELECT membership.relationship FROM identity_registration_membership AS membership
       JOIN identity_security_event AS event ON event.id = ?
       WHERE membership.id = ? AND membership.team_id = ? AND membership.account_id = ?
         AND membership.revoked_at IS NULL AND event.event_type = ?
         AND event.actor_account_id = ? AND event.actor_session_id = ?
         AND event.resource_type = 'registration' AND event.resource_id = ?`,
    )
    .bind(
      input.eventId,
      input.membershipId,
      input.teamId,
      input.context.account.id,
      input.eventType,
      input.context.account.id,
      input.context.session.id,
      String(input.teamId),
    )
    .first<{ relationship: 'owner' | 'manager' }>()
}
