import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import {
  INVITATION_SELECT,
  requireActiveRegistrationSession,
  requireRecentRegistrationAuth,
  validRegistrationTime,
} from './shared.ts'
import {
  acceptanceAuditStatement,
  acceptanceRecorded,
  ACTIVE_INVITATION_ACCEPTOR,
  invitationAcceptorProof,
} from './invitation-acceptance-proof.ts'
import type { InvitationRow } from './types.ts'
import { RegistrationWorkflowError } from './types.ts'

export async function acceptRegistrationInvitation(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  invitationId: string,
  now = Date.now(),
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(invitationId) || !validRegistrationTime(now)) {
    throw new RegistrationWorkflowError('invalid')
  }
  const authoritativeContext = await requireActiveRegistrationSession(database, context, now)
  const row = await database
    .prepare(
      `${INVITATION_SELECT}
       WHERE invitation.id = ? AND invitation.invited_account_id = ?
         AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
         AND invitation.created_at <= ? AND invitation.expires_at > ?
         AND EXISTS (
           SELECT 1 FROM identity_registration_membership AS owner
           WHERE owner.team_id = invitation.team_id
             AND owner.account_id = invitation.inviter_account_id
             AND owner.relationship = 'owner' AND owner.revoked_at IS NULL
             AND owner.granted_at <= ?
             AND (owner.expires_at IS NULL OR owner.expires_at > ?)
         ) LIMIT 1`,
    )
    .bind(invitationId, authoritativeContext.account.id, now, now, now, now)
    .first<InvitationRow>()
  if (!row) throw new RegistrationWorkflowError('not_found')
  const ownershipTransfer = row.relationship === 'owner'
  if (ownershipTransfer) requireRecentRegistrationAuth(authoritativeContext, now)
  const sessionProof = invitationAcceptorProof(authoritativeContext, now, ownershipTransfer)
  const active = await database
    .prepare(
      `SELECT id, relationship, revision FROM identity_registration_membership
       WHERE team_id = ? AND account_id = ? AND revoked_at IS NULL
         AND granted_at <= ? AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY CASE relationship WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`,
    )
    .bind(row.team_id, authoritativeContext.account.id, now, now)
    .first<{ id: string; relationship: 'owner' | 'manager'; revision: number }>()
  if (active && (row.relationship === 'manager' || active.relationship === 'owner')) {
    throw new RegistrationWorkflowError('already_has_access')
  }

  const acceptanceNonce = createOpaqueToken()
  const membershipId = createOpaqueToken()
  const membershipNonce = createOpaqueToken()
  const oldOwnerRevocationNonce = createOpaqueToken()
  const promotedManagerRevocationNonce =
    ownershipTransfer && active?.relationship === 'manager' ? createOpaqueToken() : null
  const grantReason = ownershipTransfer
    ? 'Accepted ownership transfer'
    : 'Accepted manager invitation'
  const statements = [
    database
      .prepare(
        `UPDATE identity_registration_invitation
         SET accepted_at = ?, revision = revision + 1, write_nonce = ?
         WHERE id = ? AND invited_account_id = ? AND revision = ?
           AND accepted_at IS NULL AND revoked_at IS NULL
           AND created_at <= ? AND expires_at > ?
           AND EXISTS (
             SELECT 1 FROM identity_registration_membership AS owner
             WHERE owner.team_id = identity_registration_invitation.team_id
               AND owner.account_id = identity_registration_invitation.inviter_account_id
               AND owner.relationship = 'owner' AND owner.revoked_at IS NULL
               AND owner.granted_at <= ?
               AND (owner.expires_at IS NULL OR owner.expires_at > ?)
           ) AND ${ACTIVE_INVITATION_ACCEPTOR}`,
      )
      .bind(
        now,
        acceptanceNonce,
        row.id,
        authoritativeContext.account.id,
        row.revision,
        now,
        now,
        now,
        now,
        ...sessionProof,
      ),
  ]

  if (row.relationship === 'owner' && active?.relationship === 'manager') {
    statements.push(
      database
        .prepare(
          `UPDATE identity_registration_membership
           SET revoked_at = ?, revoked_by_account_id = ?,
               revoke_reason = 'Promoted to registration owner',
               revision = revision + 1, write_nonce = ?
           WHERE id = ? AND revision = ? AND revoked_at IS NULL
             AND EXISTS (SELECT 1 FROM identity_registration_invitation
               WHERE id = ? AND accepted_at = ? AND write_nonce = ?)`,
        )
        .bind(
          now,
          authoritativeContext.account.id,
          promotedManagerRevocationNonce,
          active.id,
          active.revision,
          row.id,
          now,
          acceptanceNonce,
        ),
    )
  }
  if (row.relationship === 'owner') {
    statements.push(
      database
        .prepare(
          `UPDATE identity_registration_membership
           SET revoked_at = ?, revoked_by_account_id = ?,
               revoke_reason = 'Accepted ownership transfer',
               revision = revision + 1, write_nonce = ?
           WHERE team_id = ? AND account_id = ?
             AND relationship = 'owner' AND revoked_at IS NULL
             AND EXISTS (SELECT 1 FROM identity_registration_invitation
               WHERE id = ? AND accepted_at = ? AND write_nonce = ?)`,
        )
        .bind(
          now,
          authoritativeContext.account.id,
          oldOwnerRevocationNonce,
          row.team_id,
          row.inviter_account_id,
          row.id,
          now,
          acceptanceNonce,
        ),
    )
  }

  const acceptedInvitation = `SELECT invitation.team_id, invitation.invited_account_id,
    invitation.inviter_account_id FROM identity_registration_invitation AS invitation
    WHERE invitation.id = ? AND invitation.accepted_at = ? AND invitation.write_nonce = ?`
  statements.push(
    database
      .prepare(
        `INSERT INTO identity_registration_membership
          (id, team_id, account_id, relationship, granted_by_account_id,
           grant_reason, granted_at, write_nonce)
         SELECT ?, team_id, invited_account_id, ?, inviter_account_id, ?, ?, ?
         FROM (${acceptedInvitation})`,
      )
      .bind(
        membershipId,
        row.relationship,
        grantReason,
        now,
        membershipNonce,
        row.id,
        now,
        acceptanceNonce,
      ),
  )
  if (row.relationship === 'owner') {
    statements.push(
      database
        .prepare(
          `INSERT INTO identity_registration_membership
            (id, team_id, account_id, relationship, granted_by_account_id,
             grant_reason, granted_at)
           SELECT ?, team_id, inviter_account_id, 'manager', invited_account_id,
                  'Previous owner retained as manager', ?
           FROM (${acceptedInvitation}) AS accepted
           WHERE NOT EXISTS (
             SELECT 1 FROM identity_registration_membership AS membership
             WHERE membership.team_id = accepted.team_id
               AND membership.account_id = accepted.inviter_account_id
               AND membership.relationship = 'manager' AND membership.revoked_at IS NULL
           )`,
        )
        .bind(createOpaqueToken(), now, row.id, now, acceptanceNonce),
    )
  }
  const audit = await acceptanceAuditStatement(database, {
    context: authoritativeContext,
    invitation: row,
    now,
    acceptanceNonce,
    membershipId,
    membershipNonce,
    oldOwnerRevocationNonce,
    promotedManager:
      active?.relationship === 'manager' && promotedManagerRevocationNonce
        ? { id: active.id, nonce: promotedManagerRevocationNonce }
        : null,
    grantReason,
    sessionProof,
  })
  statements.push(audit.statement)
  try {
    await database.batch(statements)
  } catch (error) {
    if (error instanceof Error && /(?:unique|conflict|constraint)/i.test(error.message)) {
      throw new RegistrationWorkflowError('conflict')
    }
    throw error
  }
  const membership = await acceptanceRecorded(database, {
    eventId: audit.id,
    eventType: audit.type,
    membershipId,
    teamId: row.team_id,
    context: authoritativeContext,
  })
  if (!membership) throw new RegistrationWorkflowError('conflict')
  return { teamId: row.team_id, relationship: membership.relationship }
}
