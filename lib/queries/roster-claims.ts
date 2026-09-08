import 'server-only'

import type { IdentityDatabase } from '@/lib/identity/internal/contracts'

export interface RosterClaim {
  readonly playerId: number
  readonly accountId: string
  readonly displayName: string
}

export async function rosterClaims(
  database: IdentityDatabase,
  teamId: number,
): Promise<Map<number, RosterClaim>> {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return new Map()
  const { results } = await database
    .prepare(
      `SELECT membership.player_id AS player_id,
              membership.account_id AS account_id,
              account.display_name AS display_name
       FROM identity_registration_membership AS membership
       JOIN identity_account AS account ON account.id = membership.account_id
       WHERE membership.team_id = ?
         AND membership.relationship = 'player'
         AND membership.revoked_at IS NULL`,
    )
    .bind(teamId)
    .all<{ player_id: number; account_id: string; display_name: string }>()

  return new Map(
    results.map(row => [
      row.player_id,
      { playerId: row.player_id, accountId: row.account_id, displayName: row.display_name },
    ]),
  )
}
