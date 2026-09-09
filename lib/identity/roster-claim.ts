import 'server-only'

import { participantRolesForCapability } from '../authorization.ts'
import { createOpaqueToken } from '../opaque-token.ts'
import { OPAQUE_ID, validPositiveId, validTimestamp } from './internal/contracts.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  ACTIVE_INVITATION_ACCEPTOR,
  invitationAcceptorProof,
} from './registration/invitation-acceptance-proof.ts'
import { requireActiveRegistrationSession } from './registration/shared.ts'

export type RosterClaimRefusal =
  | 'not_authorised'
  | 'seat_taken'
  | 'seat_pending'
  | 'seat_missing'
  | 'self_authorised'

export type RosterClaimResult =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly reason: RosterClaimRefusal }

export interface RosterClaimInput {
  readonly playerId: number
  readonly accountId: string
  readonly authorisedByAccountId: string
  readonly reason: string
  readonly now: number
}

export interface RosterClaimRequest {
  readonly id: string
  readonly playerId: number
  readonly nickname: string
  readonly teamName: string
  readonly teamTag: string
  readonly tournamentTitle: string
  readonly inviterName: string
  readonly expiresAt: number
}

const CHECK_IN_ROLES = participantRolesForCapability('tournament.check_in.write')
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000

function refuse(reason: RosterClaimRefusal): RosterClaimResult {
  return { ok: false, reason }
}

function validInput(input: RosterClaimInput) {
  return (
    validPositiveId(input.playerId) &&
    validTimestamp(input.now) &&
    OPAQUE_ID.test(input.accountId) &&
    OPAQUE_ID.test(input.authorisedByAccountId) &&
    input.reason.trim() === input.reason &&
    input.reason.length >= 1 &&
    input.reason.length <= 500
  )
}

export async function claimRosterSeat(
  database: IdentityDatabase,
  input: RosterClaimInput,
): Promise<RosterClaimResult> {
  if (!validInput(input)) return refuse('not_authorised')
  if (input.accountId === input.authorisedByAccountId) return refuse('self_authorised')

  const seat = await database
    .prepare(
      `SELECT team.id AS team_id, team.tournament_id AS tournament_id
       FROM player JOIN team ON team.id = player.team_id
       WHERE player.id = ?`,
    )
    .bind(input.playerId)
    .first<{ team_id: number; tournament_id: number }>()
  if (!seat) return refuse('seat_missing')

  const placeholders = CHECK_IN_ROLES.map(() => '?').join(', ')
  const authorised = await database
    .prepare(
      `SELECT 1 AS allowed
       WHERE EXISTS (
         SELECT 1 FROM identity_registration_membership
         WHERE account_id = ? AND team_id = ? AND relationship = 'owner' AND revoked_at IS NULL
       ) OR EXISTS (
         SELECT 1 FROM identity_role_assignment
         WHERE account_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
           AND ((role = 'platform_owner' AND scope_type = 'platform')
             OR (role IN (${placeholders}) AND scope_type = 'tournament'
                 AND scope_tournament_id = ?))
       )`,
    )
    .bind(
      input.authorisedByAccountId,
      seat.team_id,
      input.authorisedByAccountId,
      input.now,
      ...CHECK_IN_ROLES,
      seat.tournament_id,
    )
    .first<{ allowed: number }>()
  if (authorised?.allowed !== 1) return refuse('not_authorised')

  const existing = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_membership
       WHERE player_id = ? AND relationship = 'player' AND revoked_at IS NULL`,
    )
    .bind(input.playerId)
    .first<{ present: number }>()
  if (existing) return refuse('seat_taken')

  const requestId = createOpaqueToken()
  try {
    await database
      .prepare(
        `INSERT INTO identity_roster_claim_request
          (id, player_id, invited_account_id, inviter_account_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        requestId,
        input.playerId,
        input.accountId,
        input.authorisedByAccountId,
        input.now,
        input.now + REQUEST_TTL_MS,
      )
      .run()
  } catch (error) {
    if (error instanceof Error && /(?:unique|conflict|constraint)/i.test(error.message)) {
      return refuse('seat_pending')
    }
    throw error
  }
  return { ok: true, requestId }
}

export async function listIncomingRosterClaimRequests(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
): Promise<RosterClaimRequest[]> {
  const authoritative = await requireActiveRegistrationSession(database, context, now)
  const { results } = await database
    .prepare(
      `SELECT request.id, request.player_id, player.nickname, team.name AS team_name, team.tag AS team_tag,
              tournament.title AS tournament_title, inviter.display_name AS inviter_name, request.expires_at
       FROM identity_roster_claim_request AS request
       JOIN player ON player.id = request.player_id
       JOIN team ON team.id = player.team_id
       JOIN tournament ON tournament.id = team.tournament_id
       JOIN identity_account AS inviter ON inviter.id = request.inviter_account_id
       WHERE request.invited_account_id = ? AND request.accepted_at IS NULL AND request.revoked_at IS NULL
         AND request.created_at <= ? AND request.expires_at > ?
       ORDER BY request.created_at DESC`,
    )
    .bind(authoritative.account.id, now, now)
    .all<{
      id: string
      player_id: number
      nickname: string
      team_name: string
      team_tag: string
      tournament_title: string
      inviter_name: string
      expires_at: number
    }>()
  return results.map(row => ({
    id: row.id,
    playerId: row.player_id,
    nickname: row.nickname,
    teamName: row.team_name,
    teamTag: row.team_tag,
    tournamentTitle: row.tournament_title,
    inviterName: row.inviter_name,
    expiresAt: row.expires_at,
  }))
}

export async function acceptRosterClaimRequest(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  requestId: string,
  now = Date.now(),
): Promise<RosterClaimResult> {
  if (!OPAQUE_ID.test(requestId) || !validTimestamp(now)) return refuse('not_authorised')
  const authoritative = await requireActiveRegistrationSession(database, context, now)
  const request = await database
    .prepare(
      `SELECT request.id, request.player_id, request.revision, team.id AS team_id
       FROM identity_roster_claim_request AS request
       JOIN player ON player.id = request.player_id
       JOIN team ON team.id = player.team_id
       WHERE request.id = ? AND request.invited_account_id = ?
         AND request.accepted_at IS NULL AND request.revoked_at IS NULL
         AND request.created_at <= ? AND request.expires_at > ?`,
    )
    .bind(requestId, authoritative.account.id, now, now)
    .first<{ id: string; player_id: number; revision: number; team_id: number }>()
  if (!request) return refuse('seat_missing')

  const membershipId = createOpaqueToken()
  const requestNonce = createOpaqueToken()
  const membershipNonce = createOpaqueToken()
  const sessionProof = invitationAcceptorProof(authoritative, now, false)
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE identity_roster_claim_request
           SET accepted_at = ?, revision = revision + 1, write_nonce = ?
           WHERE id = ? AND invited_account_id = ? AND revision = ?
             AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
             AND ${ACTIVE_INVITATION_ACCEPTOR}`,
        )
        .bind(
          now,
          requestNonce,
          request.id,
          authoritative.account.id,
          request.revision,
          now,
          ...sessionProof,
        ),
      database
        .prepare(
          `INSERT INTO identity_registration_membership
            (id, team_id, account_id, relationship, player_id, granted_by_account_id,
             grant_reason, granted_at, write_nonce)
           SELECT ?, ?, ?, 'player', ?, inviter_account_id, 'Accepted roster seat invitation', ?, ?
           FROM identity_roster_claim_request
           WHERE id = ? AND accepted_at = ? AND write_nonce = ?`,
        )
        .bind(
          membershipId,
          request.team_id,
          authoritative.account.id,
          request.player_id,
          now,
          membershipNonce,
          request.id,
          now,
          requestNonce,
        ),
    ])
  } catch (error) {
    if (error instanceof Error && /(?:unique|conflict|constraint)/i.test(error.message)) {
      return refuse('seat_taken')
    }
    throw error
  }
  const membership = await database
    .prepare(
      `SELECT 1 AS present FROM identity_registration_membership
       WHERE id = ? AND account_id = ? AND player_id = ? AND relationship = 'player' AND revoked_at IS NULL`,
    )
    .bind(membershipId, authoritative.account.id, request.player_id)
    .first<{ present: number }>()
  return membership ? { ok: true, requestId } : refuse('seat_taken')
}
