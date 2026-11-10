import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

export async function passCheckedIn(
  database: IdentityDatabase,
  accountId: string,
  teamId: number,
): Promise<boolean | null> {
  const row = await database
    .prepare(
      `SELECT team.checked_in_at IS NOT NULL AS checkedIn
       FROM team
       WHERE team.id = ? AND EXISTS (
         SELECT 1 FROM identity_registration_membership AS membership
         WHERE membership.team_id = team.id AND membership.account_id = ?
           AND membership.revoked_at IS NULL
       )`,
    )
    .bind(teamId, accountId)
    .first<{ checkedIn: number }>()
  return row ? Boolean(row.checkedIn) : null
}
