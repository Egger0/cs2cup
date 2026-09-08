import 'server-only'

import type { IdentityDatabase } from '@/lib/identity/internal/contracts'

export interface PlayerTournamentEntry {
  readonly tournamentSlug: string
  readonly tournamentTitle: string
  readonly season: string
  readonly teamName: string
  readonly teamTag: string
  readonly nickname: string
  readonly isSubstitute: boolean
}

export interface PlayerProfile {
  readonly displayName: string
  readonly handle: string
  readonly entries: PlayerTournamentEntry[]
}

interface ProfileRow {
  display_name: string
  public_handle: string
  tournament_slug: string | null
  tournament_title: string | null
  season: string | null
  team_name: string | null
  team_tag: string | null
  nickname: string | null
  is_substitute: number | null
}

export async function playerProfileByHandle(
  database: IdentityDatabase,
  handle: string,
): Promise<PlayerProfile | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(handle)) return null

  const { results } = await database
    .prepare(
      `SELECT account.display_name AS display_name,
              account.public_handle AS public_handle,
              tournament.slug AS tournament_slug,
              tournament.title AS tournament_title,
              tournament.season AS season,
              team.name AS team_name,
              team.tag AS team_tag,
              player.nickname AS nickname,
              player.is_substitute AS is_substitute
       FROM identity_account AS account
       LEFT JOIN identity_registration_membership AS membership
         ON membership.account_id = account.id
        AND membership.relationship = 'player'
        AND membership.revoked_at IS NULL
       LEFT JOIN player ON player.id = membership.player_id
       LEFT JOIN team ON team.id = player.team_id AND team.status = 'approved'
       LEFT JOIN tournament ON tournament.id = team.tournament_id
        AND tournament.status != 'draft'
       WHERE account.public_handle = ? AND account.status = 'active'
       ORDER BY tournament.starts_at DESC, tournament.id DESC, player.sort_order ASC`,
    )
    .bind(handle)
    .all<ProfileRow>()

  if (results.length === 0) return null

  return {
    displayName: results[0].display_name,
    handle: results[0].public_handle,
    entries: results
      .filter(row => row.tournament_slug && row.team_tag)
      .map(row => ({
        tournamentSlug: row.tournament_slug as string,
        tournamentTitle: row.tournament_title as string,
        season: row.season as string,
        teamName: row.team_name as string,
        teamTag: row.team_tag as string,
        nickname: row.nickname as string,
        isSubstitute: row.is_substitute === 1,
      })),
  }
}
