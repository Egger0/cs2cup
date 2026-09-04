import 'server-only'

import { authorize } from '../internal/authorization.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import { privateSessionContext } from '../internal/session-context.ts'
import { resolveAuthContextFromHash } from '../internal/session-resolution.ts'
import type { InvitationRow, RegistrationInvitation } from './types.ts'
import { RegistrationWorkflowError } from './types.ts'

export const REGISTRATION_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/
export const REGISTRATION_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const REGISTRATION_RECENT_AUTH_MS = 15 * 60 * 1000

export const INVITATION_SELECT = `SELECT invitation.id, invitation.team_id,
  team.name AS team_name, team.tag AS team_tag,
  tournament.slug AS tournament_slug, tournament.title AS tournament_title,
  invitation.relationship, invitation.invited_account_id, invitation.inviter_account_id,
  invited.display_name AS invited_name, password.username AS invited_username,
  inviter.display_name AS inviter_name, invitation.expires_at, invitation.revision
  FROM identity_registration_invitation AS invitation
  JOIN team ON team.id = invitation.team_id
  JOIN tournament ON tournament.id = team.tournament_id
  JOIN identity_account AS invited ON invited.id = invitation.invited_account_id
  JOIN identity_account AS inviter ON inviter.id = invitation.inviter_account_id
  LEFT JOIN identity_password_credential AS password
    ON password.account_id = invited.id AND password.status = 'active'`

export function validRegistrationTime(now: number) {
  return Number.isSafeInteger(now) && now >= 0
}

export function requireRecentRegistrationAuth(context: AuthenticatedAuthContext, now: number) {
  if (
    context.session.recoveryRestricted ||
    context.session.authenticatedAt > now ||
    context.session.authenticatedAt < now - REGISTRATION_RECENT_AUTH_MS
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
}

export async function requireActiveRegistrationSession(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  if (context.session.recoveryRestricted || !validRegistrationTime(now)) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new RegistrationWorkflowError('reauth_required')
  const authoritative = await resolveAuthContextFromHash(database, privateContext.tokenHash, now)
  if (
    authoritative.kind === 'anonymous' ||
    authoritative.account.id !== context.account.id ||
    authoritative.session.id !== context.session.id ||
    authoritative.session.recoveryRestricted
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  return authoritative
}

export async function requireRegistrationCapability(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  capability:
    | 'registration.view'
    | 'registration.edit'
    | 'registration.invite'
    | 'registration.transfer'
    | 'registration.delete',
  now: number,
) {
  const decision = await authorize(
    database,
    context,
    capability,
    { kind: 'registration', registrationId: teamId },
    undefined,
    now,
  )
  if (decision.ok) return decision
  if (
    decision.reason === 'assurance_required' ||
    decision.reason === 'recovery_restricted' ||
    decision.reason === 'session_invalid'
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  throw new RegistrationWorkflowError('forbidden')
}

export function mapRegistrationInvitation(row: InvitationRow): RegistrationInvitation {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    teamTag: row.team_tag,
    tournamentSlug: row.tournament_slug,
    tournamentTitle: row.tournament_title,
    relationship: row.relationship,
    accountId: row.invited_account_id,
    accountName: row.invited_name,
    username: row.invited_username,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
  }
}
