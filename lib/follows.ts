import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

export const FOLLOW_LIMIT = 100

export function parseFollowIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > FOLLOW_LIMIT) return null
  return raw.every(id => Number.isSafeInteger(id) && id > 0) ? [...new Set<number>(raw)] : null
}

export async function listFollowedTournamentIds(database: IdentityDatabase, accountId: string) {
  const { results } = await database
    .prepare(
      'SELECT tournament_id AS id FROM tournament_follow WHERE account_id = ? ORDER BY created_at ASC',
    )
    .bind(accountId)
    .all<{ id: number }>()
  return results.map(row => row.id)
}

export async function followTournaments(
  database: IdentityDatabase,
  accountId: string,
  ids: readonly number[],
  now: number,
) {
  for (const id of ids) {
    try {
      await database
        .prepare(
          `INSERT INTO tournament_follow (account_id, tournament_id, created_at) VALUES (?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(accountId, id, now)
        .run()
    } catch (error) {
      if (!(error instanceof Error) || !/tournament follow rejected/.test(error.message))
        throw error
    }
  }
}

export async function unfollowTournament(
  database: IdentityDatabase,
  accountId: string,
  id: number,
) {
  await database
    .prepare('DELETE FROM tournament_follow WHERE account_id = ? AND tournament_id = ?')
    .bind(accountId, id)
    .run()
}
