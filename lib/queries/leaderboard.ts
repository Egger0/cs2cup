import 'server-only'

import type { IdentityDatabase } from '@/lib/identity/internal/contracts'

export const LEADERBOARD_SIZE = 20

export interface LeaderboardRow {
  readonly handle: string
  readonly name: string
  readonly score: number
}

export async function stardustLeaderboard(database: IdentityDatabase): Promise<LeaderboardRow[]> {
  const { results } = await database
    .prepare(
      `SELECT account.public_handle AS handle, account.display_name AS name,
              balance.balance AS score
       FROM stardust_balance AS balance
       JOIN identity_account AS account ON account.id = balance.account_id
       WHERE account.public_handle IS NOT NULL AND account.status = 'active'
         AND balance.balance > 0
       ORDER BY balance.balance DESC, account.public_handle ASC LIMIT ?`,
    )
    .bind(LEADERBOARD_SIZE)
    .all<LeaderboardRow>()
  return results
}

export async function loadoutLeaderboard(database: IdentityDatabase): Promise<LeaderboardRow[]> {
  const { results } = await database
    .prepare(
      `SELECT account.public_handle AS handle, account.display_name AS name,
              COUNT(*) AS score
       FROM loadout_like AS liked
       JOIN loadout_code AS code ON code.id = liked.code_id AND code.status = 'approved'
       JOIN identity_account AS account ON account.id = code.account_id
       WHERE account.public_handle IS NOT NULL AND account.status = 'active'
         AND liked.account_id != code.account_id
       GROUP BY account.id
       ORDER BY score DESC, account.public_handle ASC LIMIT ?`,
    )
    .bind(LEADERBOARD_SIZE)
    .all<LeaderboardRow>()
  return results
}
