import 'server-only'
import { cloudflareBindings } from '../../cloudflare-bindings'
import { RdbError, selectPublicRow, selectPublicRows } from '../../rdb'
import { registrationAvailability } from '../../registration'
import type { FaqItem, RuleItem, Tournament, TournamentStatus } from '../../types'
import { getMatches, getPublicTeams } from './matches'

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
    order: 'season.desc,edition.desc',
  })
  return rows.map(toTournament)
}

export async function getTournament(slug: string): Promise<Tournament | null> {
  const row = await selectPublicRow<TournamentRow>('tournament_public', {
    filters: { slug: `eq.${slug}` },
  })
  return row ? toTournament(row) : null
}

export async function getCurrentTournament(): Promise<Tournament | null> {
  const rows = await selectPublicRows<TournamentRow>('tournament_public', {
    filters: { status: 'in.(registration,running,postponed)' },
    order: 'season.desc,edition.desc',
    limit: 1,
  })
  return rows[0] ? toTournament(rows[0]) : null
}

interface RegistrationStatus {
  cap: number
  taken: number
  open: boolean
}

export async function getRegistrationStatus(slug: string): Promise<RegistrationStatus> {
  const row = await cloudflareBindings()
    .db.prepare(
      "SELECT t.team_cap AS cap, COUNT(team.id) AS taken, t.status, t.reg_deadline AS regDeadline, unixepoch('now') * 1000 AS nowMs FROM tournament t LEFT JOIN team ON team.tournament_id = t.id AND team.status != 'rejected' WHERE t.slug = ? GROUP BY t.id",
    )
    .bind(slug)
    .first<{
      cap: number
      taken: number
      status: string
      regDeadline: string | null
      nowMs: number
    }>()
  if (!row) throw new RdbError(404, 'registration_status', 'tournament not found')
  const availability = registrationAvailability(
    { status: row.status, regDeadline: row.regDeadline, teamCap: row.cap },
    row.taken,
    row.nowMs,
  )
  return { cap: row.cap, taken: row.taken, open: availability.open }
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
