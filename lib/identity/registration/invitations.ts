import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import { normalizeUsername } from '../internal/username-policy.ts'
import {
  INVITATION_SELECT,
  mapRegistrationInvitation,
  REGISTRATION_INVITATION_TTL_MS,
  requireActiveRegistrationSession,
  requireRegistrationCapability,
  validRegistrationTime,
} from './shared.ts'
import type { InvitationRow, RegistrationCollaborator } from './types.ts'
import { RegistrationWorkflowError } from './types.ts'

export async function listIncomingRegistrationInvitations(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  if (!validRegistrationTime(now)) throw new TypeError('Invalid invitation list time')
  await requireActiveRegistrationSession(database, context, now)
  const rows = (
    await database
      .prepare(
        `${INVITATION_SELECT}
         WHERE invitation.invited_account_id = ? AND invitation.accepted_at IS NULL
           AND invitation.revoked_at IS NULL AND invitation.created_at <= ?
           AND invitation.expires_at > ?
         ORDER BY invitation.created_at DESC`,
      )
      .bind(context.account.id, now, now)
      .all<InvitationRow>()
  ).results
  return rows.map(mapRegistrationInvitation)
}

export async function registrationAccessOverview(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  now = Date.now(),
) {
  await requireRegistrationCapability(database, context, teamId, 'registration.view', now)
  const owner = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_membership
       WHERE team_id = ? AND account_id = ? AND relationship = 'owner'
         AND revoked_at IS NULL AND granted_at <= ?
         AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    )
    .bind(teamId, context.account.id, now, now)
    .first<{ present: number }>()
  if (!owner) throw new RegistrationWorkflowError('forbidden')
  const [managerRows, invitationRows] = await Promise.all([
    database
      .prepare(
        `SELECT membership.id AS membership_id, membership.account_id,
                account.display_name, password.username, membership.granted_at
         FROM identity_registration_membership AS membership
         JOIN identity_account AS account ON account.id = membership.account_id
         LEFT JOIN identity_password_credential AS password
           ON password.account_id = account.id AND password.status = 'active'
         WHERE membership.team_id = ? AND membership.relationship = 'manager'
           AND membership.revoked_at IS NULL AND membership.granted_at <= ?
           AND (membership.expires_at IS NULL OR membership.expires_at > ?)
         ORDER BY membership.granted_at, membership.id`,
      )
      .bind(teamId, now, now)
      .all<{
        membership_id: string
        account_id: string
        display_name: string
        username: string | null
        granted_at: number
      }>(),
    database
      .prepare(
        `${INVITATION_SELECT}
         WHERE invitation.team_id = ? AND invitation.accepted_at IS NULL
           AND invitation.revoked_at IS NULL AND invitation.expires_at > ?
         ORDER BY invitation.created_at DESC`,
      )
      .bind(teamId, now)
      .all<InvitationRow>(),
  ])
  return {
    managers: managerRows.results.map(
      row =>
        ({
          membershipId: row.membership_id,
          accountId: row.account_id,
          displayName: row.display_name,
          username: row.username,
          grantedAt: row.granted_at,
        }) satisfies RegistrationCollaborator,
    ),
    invitations: invitationRows.results.map(mapRegistrationInvitation),
  }
}

async function accountForUsername(database: IdentityDatabase, value: unknown) {
  const username = normalizeUsername(value)
  if (!username) throw new RegistrationWorkflowError('account_not_found')
  return database
    .prepare(
      `SELECT account.id FROM identity_password_credential AS password
       JOIN identity_account AS account ON account.id = password.account_id
       WHERE password.username = ? AND password.status = 'active'
         AND account.status = 'active' LIMIT 1`,
    )
    .bind(username)
    .first<{ id: string }>()
}

export async function createRegistrationInvitation(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: {
    teamId: number
    username: unknown
    relationship: 'owner' | 'manager'
    now?: number
  },
) {
  const now = input.now ?? Date.now()
  if (
    !Number.isSafeInteger(input.teamId) ||
    input.teamId <= 0 ||
    !validRegistrationTime(now) ||
    !['owner', 'manager'].includes(input.relationship)
  ) {
    throw new RegistrationWorkflowError('invalid')
  }
  await requireRegistrationCapability(
    database,
    context,
    input.teamId,
    input.relationship === 'owner' ? 'registration.transfer' : 'registration.invite',
    now,
  )
  const target = await accountForUsername(database, input.username)
  if (!target) throw new RegistrationWorkflowError('account_not_found')
  if (target.id === context.account.id) throw new RegistrationWorkflowError('already_has_access')
  const existing = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_membership
       WHERE team_id = ? AND account_id = ? AND revoked_at IS NULL
         AND granted_at <= ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    )
    .bind(input.teamId, target.id, now, now)
    .first<{ present: number }>()
  if (existing) throw new RegistrationWorkflowError('already_has_access')

  const expired = (
    await database
      .prepare(
        `SELECT id FROM identity_registration_invitation
         WHERE team_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at <= ? AND (invited_account_id = ? OR (? = 'owner' AND relationship = 'owner'))`,
      )
      .bind(input.teamId, now, target.id, input.relationship)
      .all<{ id: string }>()
  ).results
  const id = createOpaqueToken()
  const statements = expired.map(row =>
    database
      .prepare(
        `UPDATE identity_registration_invitation
         SET revoked_at = ?, revoked_by_account_id = ?, revoke_reason = 'Expired before reissue',
             revision = revision + 1, write_nonce = ?
         WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?`,
      )
      .bind(now, context.account.id, createOpaqueToken(), row.id, now),
  )
  statements.push(
    database
      .prepare(
        `INSERT INTO identity_registration_invitation
          (id, team_id, invited_account_id, relationship, inviter_account_id,
           created_at, expires_at)
         SELECT ?, team.id, ?, ?, ?, ?, ? FROM team
         WHERE team.id = ? AND EXISTS (
           SELECT 1 FROM identity_registration_membership AS owner
           WHERE owner.team_id = team.id AND owner.account_id = ?
             AND owner.relationship = 'owner' AND owner.revoked_at IS NULL
             AND owner.granted_at <= ?
             AND (owner.expires_at IS NULL OR owner.expires_at > ?)
         )`,
      )
      .bind(
        id,
        target.id,
        input.relationship,
        context.account.id,
        now,
        now + REGISTRATION_INVITATION_TTL_MS,
        input.teamId,
        context.account.id,
        now,
        now,
      ),
  )
  try {
    await database.batch(statements)
  } catch (error) {
    if (error instanceof Error && /(?:unique|conflict|constraint)/i.test(error.message)) {
      throw new RegistrationWorkflowError('conflict')
    }
    throw error
  }
  const created = await database
    .prepare(`${INVITATION_SELECT} WHERE invitation.id = ? LIMIT 1`)
    .bind(id)
    .first<InvitationRow>()
  if (!created) throw new RegistrationWorkflowError('conflict')
  return mapRegistrationInvitation(created)
}
