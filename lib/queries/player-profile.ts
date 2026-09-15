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
  readonly champion: boolean
  readonly gameSlug: string | null
}

export interface PlayerGameCard {
  readonly slug: string
  readonly name: string
  readonly nameEn: string | null
  readonly accentColor: string | null
  readonly entries: number
  readonly titles: number
  readonly latestTeam: string
  readonly latestSeason: string
}

export type PlayerBadgeKey = 'debut' | 'veteran' | 'champion' | 'oracle' | 'regular'

export interface PlayerBadge {
  readonly key: PlayerBadgeKey
  readonly label: string
  readonly detail: string
}

export interface PlayerProfile {
  readonly displayName: string
  readonly handle: string
  readonly entries: PlayerTournamentEntry[]
  readonly games: PlayerGameCard[]
  readonly badges: PlayerBadge[]
}

interface ProfileRow {
  account_id: string
  display_name: string
  public_handle: string
  tournament_slug: string | null
  tournament_title: string | null
  season: string | null
  team_name: string | null
  team_tag: string | null
  nickname: string | null
  is_substitute: number | null
  champion: number | null
  game_slug: string | null
  game_name: string | null
  game_name_en: string | null
  game_accent: string | null
}

const CHAMPION = `tournament.status = 'finished' AND (
  tournament.champion_name = team.name
  OR team.id = (
    SELECT winner_team_id FROM match
    WHERE match.tournament_id = tournament.id
    ORDER BY match.round DESC, match.slot ASC LIMIT 1
  )
)`

function gameCards(entries: PlayerTournamentEntry[], rows: ProfileRow[]): PlayerGameCard[] {
  const cards = new Map<string, PlayerGameCard>()
  entries.forEach((entry, index) => {
    const row = rows[index]
    if (!entry.gameSlug || !row?.game_name) return
    const card = cards.get(entry.gameSlug)
    cards.set(entry.gameSlug, {
      slug: entry.gameSlug,
      name: row.game_name,
      nameEn: row.game_name_en,
      accentColor: row.game_accent,
      entries: (card?.entries ?? 0) + 1,
      titles: (card?.titles ?? 0) + (entry.champion ? 1 : 0),
      latestTeam: card?.latestTeam ?? entry.teamName,
      latestSeason: card?.latestSeason ?? entry.season,
    })
  })
  return [...cards.values()].sort((a, b) => b.entries - a.entries)
}

function badgesFor(
  entries: number,
  titles: number,
  wonPredictions: number,
  checkIns: number,
): PlayerBadge[] {
  const badges: (PlayerBadge | false)[] = [
    entries >= 1 && { key: 'debut', label: '首次出征', detail: '登上过社团赛事名单' },
    entries >= 3 && { key: 'veteran', label: '三届老兵', detail: `参加过 ${entries} 届赛事` },
    titles >= 1 && { key: 'champion', label: '冠军', detail: `捧起过 ${titles} 座冠军奖杯` },
    wonPredictions >= 3 && {
      key: 'oracle',
      label: '预言家',
      detail: `赛前预测命中 ${wonPredictions} 场`,
    },
    checkIns >= 30 && { key: 'regular', label: '全勤', detail: `累计签到 ${checkIns} 天` },
  ]
  return badges.filter((badge): badge is PlayerBadge => Boolean(badge))
}

export async function playerProfileByHandle(
  database: IdentityDatabase,
  handle: string,
): Promise<PlayerProfile | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(handle)) return null

  const { results } = await database
    .prepare(
      `SELECT account.id AS account_id,
              account.display_name AS display_name,
              account.public_handle AS public_handle,
              tournament.slug AS tournament_slug,
              tournament.title AS tournament_title,
              tournament.season AS season,
              team.name AS team_name,
              team.tag AS team_tag,
              player.nickname AS nickname,
              player.is_substitute AS is_substitute,
              CASE WHEN tournament.id IS NULL THEN NULL WHEN ${CHAMPION} THEN 1 ELSE 0 END
                AS champion,
              game.slug AS game_slug,
              game.name AS game_name,
              game.name_en AS game_name_en,
              game.accent_color AS game_accent
       FROM identity_account AS account
       LEFT JOIN identity_registration_membership AS membership
         ON membership.account_id = account.id
        AND membership.relationship = 'player'
        AND membership.revoked_at IS NULL
       LEFT JOIN player ON player.id = membership.player_id
       LEFT JOIN team ON team.id = player.team_id AND team.status = 'approved'
       LEFT JOIN tournament ON tournament.id = team.tournament_id
        AND tournament.status != 'draft'
       LEFT JOIN game ON game.id = tournament.game_id AND game.active = 1
       WHERE account.public_handle = ? AND account.status = 'active'
       ORDER BY tournament.starts_at DESC, tournament.id DESC, player.sort_order ASC`,
    )
    .bind(handle)
    .all<ProfileRow>()

  const [first] = results
  if (!first) return null

  const rows = results.filter(row => row.tournament_slug && row.team_tag)
  const entries = rows.map(row => ({
    tournamentSlug: row.tournament_slug as string,
    tournamentTitle: row.tournament_title as string,
    season: row.season as string,
    teamName: row.team_name as string,
    teamTag: row.team_tag as string,
    nickname: row.nickname as string,
    isSubstitute: row.is_substitute === 1,
    champion: row.champion === 1,
    gameSlug: row.game_slug,
  }))
  const activity = await database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM match_prediction_outcome
          WHERE account_id = ? AND status = 'won') AS won,
         (SELECT COUNT(*) FROM stardust_grant WHERE account_id = ? AND kind = 'check_in') AS checkIns`,
    )
    .bind(first.account_id, first.account_id)
    .first<{ won: number; checkIns: number }>()

  return {
    displayName: first.display_name,
    handle: first.public_handle,
    entries,
    games: gameCards(entries, rows),
    badges: badgesFor(
      entries.length,
      entries.filter(entry => entry.champion).length,
      Number(activity?.won ?? 0),
      Number(activity?.checkIns ?? 0),
    ),
  }
}
