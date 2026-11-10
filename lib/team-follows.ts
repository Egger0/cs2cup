import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

export interface FollowedTeam {
  readonly teamId: number
  readonly name: string
  readonly tag: string
  readonly tournamentSlug: string
  readonly tournamentTitle: string
}

export async function setTeamFollow(
  database: IdentityDatabase,
  input: { accountId: string; teamId: number; follow: boolean },
  now: number,
): Promise<boolean> {
  if (!input.follow) {
    await database
      .prepare('DELETE FROM team_follow WHERE account_id = ? AND team_id = ?')
      .bind(input.accountId, input.teamId)
      .run()
    return true
  }
  try {
    await database
      .prepare(
        `INSERT INTO team_follow (account_id, team_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(input.accountId, input.teamId, now)
      .run()
    return true
  } catch (error) {
    if (error instanceof Error && /team follow rejected/.test(error.message)) return false
    throw error
  }
}

export async function teamFollowState(
  database: IdentityDatabase,
  teamId: number,
  accountId: string | null,
) {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS followers, COALESCE(MAX(account_id = ?), 0) AS following
       FROM team_follow WHERE team_id = ?`,
    )
    .bind(accountId ?? '', teamId)
    .first<{ followers: number; following: number }>()
  return { followers: Number(row?.followers ?? 0), following: Boolean(row?.following) }
}

export async function followedTeams(
  database: IdentityDatabase,
  accountId: string,
): Promise<FollowedTeam[]> {
  const { results } = await database
    .prepare(
      `SELECT team.id AS teamId, team.name, team.tag, tournament.slug AS tournamentSlug,
              tournament.title AS tournamentTitle
       FROM team_follow AS follow
       JOIN team ON team.id = follow.team_id
       JOIN tournament ON tournament.id = team.tournament_id
       WHERE follow.account_id = ? AND team.status = 'approved' AND tournament.status != 'draft'
       ORDER BY follow.created_at DESC LIMIT 50`,
    )
    .bind(accountId)
    .all<FollowedTeam>()
  return results
}
