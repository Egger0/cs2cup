import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import { hashRegistrationToken } from '../../registration-access.ts'
import type { TeamStatus } from '../../types.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import {
  REGISTRATION_SLUG,
  requireActiveRegistrationSession,
  requireRecentRegistrationAuth,
  requireRegistrationCapability,
  validRegistrationTime,
} from './shared.ts'
import { RegistrationWorkflowError } from './types.ts'

const TOKEN_REPLAY_WINDOW_MS = 15 * 60 * 1000

export async function revokeRegistrationInvitation(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { teamId: number; invitationId: string; now?: number },
) {
  const now = input.now ?? Date.now()
  await requireRegistrationCapability(database, context, input.teamId, 'registration.invite', now)
  const nonce = createOpaqueToken()
  await database
    .prepare(
      `UPDATE identity_registration_invitation
       SET revoked_at = ?, revoked_by_account_id = ?, revoke_reason = 'Cancelled by owner',
           revision = revision + 1, write_nonce = ?
       WHERE id = ? AND team_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .bind(now, context.account.id, nonce, input.invitationId, input.teamId)
    .run()
  const revoked = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_invitation
       WHERE id = ? AND revoked_at = ? AND write_nonce = ?`,
    )
    .bind(input.invitationId, now, nonce)
    .first<{ present: number }>()
  if (!revoked) throw new RegistrationWorkflowError('not_found')
}

export async function removeRegistrationManager(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { teamId: number; membershipId: string; now?: number },
) {
  const now = input.now ?? Date.now()
  await requireRegistrationCapability(database, context, input.teamId, 'registration.invite', now)
  const nonce = createOpaqueToken()
  await database
    .prepare(
      `UPDATE identity_registration_membership
       SET revoked_at = ?, revoked_by_account_id = ?, revoke_reason = 'Removed by owner',
           revision = revision + 1, write_nonce = ?
       WHERE id = ? AND team_id = ? AND relationship = 'manager' AND revoked_at IS NULL`,
    )
    .bind(now, context.account.id, nonce, input.membershipId, input.teamId)
    .run()
  const revoked = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_membership
       WHERE id = ? AND revoked_at = ? AND write_nonce = ?`,
    )
    .bind(input.membershipId, now, nonce)
    .first<{ present: number }>()
  if (!revoked) throw new RegistrationWorkflowError('not_found')
}

export async function attachLegacyRegistration(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { slug: string; token: string; now?: number },
) {
  const now = input.now ?? Date.now()
  if (!REGISTRATION_SLUG.test(input.slug) || !validRegistrationTime(now)) {
    throw new RegistrationWorkflowError('invalid')
  }
  await requireActiveRegistrationSession(database, context, now)
  requireRecentRegistrationAuth(context, now)
  const tokenHash = await hashRegistrationToken(input.token)
  if (!tokenHash) throw new RegistrationWorkflowError('not_found')
  const replay = await redeemedLegacyRegistration(database, tokenHash, context.account.id, now)
  if (replay) return { teamId: replay.team_id }
  const team = await database
    .prepare(
      `SELECT team.id,
              (SELECT account_id FROM identity_registration_membership
               WHERE team_id = team.id AND relationship = 'owner' AND revoked_at IS NULL
               LIMIT 1) AS owner_account_id
       FROM team JOIN tournament ON tournament.id = team.tournament_id
       WHERE tournament.slug = ? AND team.management_token_hash = ? LIMIT 1`,
    )
    .bind(input.slug, tokenHash)
    .first<{ id: number; owner_account_id: string | null }>()
  if (!team) throw new RegistrationWorkflowError('not_found')
  if (team.owner_account_id === context.account.id) {
    await database.batch([
      legacyRedemptionStatement(database, tokenHash, team.id, context.account.id, now, ''),
      consumeLegacyTokenStatement(database, tokenHash, team.id, context.account.id),
    ])
    return attachedLegacyRegistration(database, tokenHash, context.account.id, now)
  }
  if (team.owner_account_id) throw new RegistrationWorkflowError('already_has_access')
  const id = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_registration_membership
            (id, team_id, account_id, relationship, granted_by_account_id,
             grant_reason, granted_at)
           SELECT ?, team.id, ?, 'owner', ?, 'Legacy management link attached', ?
           FROM team JOIN tournament ON tournament.id = team.tournament_id
           WHERE team.id = ? AND tournament.slug = ? AND team.management_token_hash = ?
             AND NOT EXISTS (
               SELECT 1 FROM identity_registration_membership AS owner
               WHERE owner.team_id = team.id AND owner.relationship = 'owner'
                 AND owner.revoked_at IS NULL
             )`,
        )
        .bind(id, context.account.id, context.account.id, now, team.id, input.slug, tokenHash),
      legacyRedemptionStatement(database, tokenHash, team.id, context.account.id, now, id),
      consumeLegacyTokenStatement(database, tokenHash, team.id, context.account.id),
    ])
  } catch (error) {
    if (error instanceof Error && /(?:unique|conflict|constraint)/i.test(error.message)) {
      throw new RegistrationWorkflowError('conflict')
    }
    throw error
  }
  return attachedLegacyRegistration(database, tokenHash, context.account.id, now)
}

function legacyRedemptionStatement(
  database: IdentityDatabase,
  tokenHash: string,
  teamId: number,
  accountId: string,
  now: number,
  membershipId: string,
) {
  return database
    .prepare(
      `INSERT INTO identity_registration_token_redemption
        (token_hash, team_id, account_id, redeemed_at, replay_expires_at)
       SELECT ?, team.id, ?, ?, ? FROM team
       WHERE team.id = ? AND team.management_token_hash = ?
         AND EXISTS (SELECT 1 FROM identity_registration_membership AS owner
           WHERE owner.team_id = team.id AND owner.account_id = ?
             AND owner.relationship = 'owner' AND owner.revoked_at IS NULL
             AND (? = '' OR owner.id = ?))
         AND NOT EXISTS (SELECT 1 FROM identity_registration_token_redemption
           WHERE token_hash = ? OR team_id = team.id)`,
    )
    .bind(
      tokenHash,
      accountId,
      now,
      now + TOKEN_REPLAY_WINDOW_MS,
      teamId,
      tokenHash,
      accountId,
      membershipId,
      membershipId,
      tokenHash,
    )
}

function consumeLegacyTokenStatement(
  database: IdentityDatabase,
  tokenHash: string,
  teamId: number,
  accountId: string,
) {
  return database
    .prepare(
      `UPDATE team SET management_token_hash = NULL
       WHERE id = ? AND management_token_hash = ? AND EXISTS (
         SELECT 1 FROM identity_registration_token_redemption
         WHERE token_hash = ? AND team_id = team.id AND account_id = ?
       )`,
    )
    .bind(teamId, tokenHash, tokenHash, accountId)
}

async function redeemedLegacyRegistration(
  database: IdentityDatabase,
  tokenHash: string,
  accountId: string,
  now: number,
) {
  return database
    .prepare(
      `SELECT redemption.team_id FROM identity_registration_token_redemption AS redemption
       JOIN identity_registration_membership AS owner
         ON owner.team_id = redemption.team_id AND owner.account_id = redemption.account_id
       WHERE redemption.token_hash = ? AND redemption.account_id = ?
         AND redemption.replay_expires_at > ? AND owner.relationship = 'owner'
         AND owner.revoked_at IS NULL LIMIT 1`,
    )
    .bind(tokenHash, accountId, now)
    .first<{ team_id: number }>()
}

async function attachedLegacyRegistration(
  database: IdentityDatabase,
  tokenHash: string,
  accountId: string,
  now: number,
) {
  const attached = await redeemedLegacyRegistration(database, tokenHash, accountId, now)
  if (!attached) throw new RegistrationWorkflowError('conflict')
  return { teamId: attached.team_id }
}

export async function deleteOwnedRegistration(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  now = Date.now(),
) {
  await requireRegistrationCapability(database, context, teamId, 'registration.delete', now)
  const row = await database
    .prepare(
      `SELECT team.status FROM team
       JOIN identity_registration_membership AS owner ON owner.team_id = team.id
       WHERE team.id = ? AND owner.account_id = ? AND owner.relationship = 'owner'
         AND owner.revoked_at IS NULL LIMIT 1`,
    )
    .bind(teamId, context.account.id)
    .first<{ status: TeamStatus }>()
  if (!row) throw new RegistrationWorkflowError('forbidden')
  if (row.status !== 'pending') throw new RegistrationWorkflowError('locked')
  await database
    .prepare(
      `DELETE FROM team WHERE id = ? AND status = 'pending' AND EXISTS (
         SELECT 1 FROM identity_registration_membership AS owner
         WHERE owner.team_id = team.id AND owner.account_id = ?
           AND owner.relationship = 'owner' AND owner.revoked_at IS NULL
       )`,
    )
    .bind(teamId, context.account.id)
    .run()
  const remaining = await database
    .prepare('SELECT 1 AS present FROM team WHERE id = ?')
    .bind(teamId)
    .first<{ present: number }>()
  if (remaining) throw new RegistrationWorkflowError('conflict')
}
