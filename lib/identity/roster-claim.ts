import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import { OPAQUE_ID, validPositiveId, validTimestamp } from './internal/contracts.ts'
import { participantRolesForCapability } from '../authorization.ts'
import type { IdentityDatabase } from './internal/contracts.ts'

export type RosterClaimRefusal =
  | 'not_authorised'
  | 'seat_taken'
  | 'seat_missing'
  | 'self_authorised'

export type RosterClaimResult =
  | { readonly ok: true; readonly membershipId: string }
  | { readonly ok: false; readonly reason: RosterClaimRefusal }

export interface RosterClaimInput {
  readonly playerId: number
  readonly accountId: string
  readonly authorisedByAccountId: string
  readonly reason: string
  readonly now: number
}

const CHECK_IN_ROLES = participantRolesForCapability('tournament.check_in.write')

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
         WHERE account_id = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND (
             (role = 'platform_owner' AND scope_type = 'platform')
             OR (role IN (${placeholders}) AND scope_type = 'tournament'
                 AND scope_tournament_id = ?)
           )
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
      `SELECT id, account_id FROM identity_registration_membership
       WHERE player_id = ? AND revoked_at IS NULL`,
    )
    .bind(input.playerId)
    .first<{ id: string; account_id: string }>()
  if (existing) {
    return existing.account_id === input.accountId
      ? { ok: true, membershipId: existing.id }
      : refuse('seat_taken')
  }

  const membershipId = createOpaqueToken()
  await database
    .prepare(
      `INSERT INTO identity_registration_membership
        (id, team_id, account_id, relationship, player_id, granted_by_account_id,
         grant_reason, granted_at)
       VALUES (?, ?, ?, 'player', ?, ?, ?, ?)`,
    )
    .bind(
      membershipId,
      seat.team_id,
      input.accountId,
      input.playerId,
      input.authorisedByAccountId,
      input.reason,
      input.now,
    )
    .run()

  return { ok: true, membershipId }
}
