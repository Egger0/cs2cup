import 'server-only'
import { callPublicFunction, selectPublicRow, selectPublicRows } from '../../rdb'
import type { FaqItem, RuleItem, Tournament, TournamentStatus } from '../../types'
import { getMatches, getPublicTeams } from './matches'

const TOURNAMENT_SELECT =
  'id,slug,title,game_id,game(slug,name),season,edition,status,format,team_cap,' +
  'reg_deadline,starts_at,accent_color,map_pool,rules,faqs,hero_eyebrow,hero_top,' +
  'hero_bottom,lede,champion_name,champion_note'

interface TournamentRow {
  id: number
  slug: string
  title: string
  game_id: number | null
  game: { slug: string; name: string } | null
  season: string
  edition: number
  status: TournamentStatus
  format: string
  team_cap: number
  reg_deadline: string | null
  starts_at: string | null
  accent_color: string | null
  map_pool: string[]
  rules: RuleItem[]
  faqs: FaqItem[]
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
  champion_name: string | null
  champion_note: string | null
}

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    gameId: row.game_id,
    gameSlug: row.game?.slug ?? null,
    gameName: row.game?.name ?? null,
    season: row.season,
    edition: row.edition,
    status: row.status,
    format: row.format,
    teamCap: row.team_cap,
    regDeadline: row.reg_deadline,
    startsAt: row.starts_at,
    accentColor: row.accent_color,
    mapPool: row.map_pool ?? [],
    rules: row.rules ?? [],
    faqs: row.faqs ?? [],
    heroEyebrow: row.hero_eyebrow,
    heroTop: row.hero_top,
    heroBottom: row.hero_bottom,
    lede: row.lede,
    championName: row.champion_name,
    championNote: row.champion_note,
  }
}

export async function listTournaments(): Promise<Tournament[]> {
  const rows = await selectPublicRows<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    order: 'season.desc,edition.desc',
  })
  return rows.map(toTournament)
}

export async function getTournament(slug: string): Promise<Tournament | null> {
  const row = await selectPublicRow<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    filters: { slug: `eq.${slug}` },
  })
  return row ? toTournament(row) : null
}

export async function getCurrentTournament(): Promise<Tournament | null> {
  const rows = await selectPublicRows<TournamentRow>('tournament_public', {
    select: TOURNAMENT_SELECT,
    filters: { status: 'neq.finished' },
    order: 'season.desc,edition.desc',
    limit: 1,
  })
  return rows[0] ? toTournament(rows[0]) : null
}

export interface RegistrationStatus {
  cap: number
  taken: number
  open: boolean
}

export function getRegistrationStatus(slug: string) {
  return callPublicFunction<RegistrationStatus>('registration_status', { p_slug: slug })
}

export async function listHonours() {
  const tournaments = await listTournaments()
  const finished = tournaments.filter(tournament => tournament.status === 'finished')

  return Promise.all(
    finished.map(async tournament => {
      if (tournament.championName) {
        return { tournament, champion: tournament.championName }
      }
      const [matches, teams] = await Promise.all([
        getMatches(tournament.id),
        getPublicTeams(tournament.id),
      ])
      const finalRound = matches.reduce((best, match) => Math.max(best, match.round), -1)
      const decider = matches.find(match => match.round === finalRound)
      const winner = decider?.winnerTeamId
        ? teams.find(team => team.id === decider.winnerTeamId)
        : undefined
      return { tournament, champion: winner?.name ?? null }
    }),
  )
}
