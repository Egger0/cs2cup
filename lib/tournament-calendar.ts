import { serializeICalendar } from './icalendar'
import { buildScheduleEntries } from './schedule'
import type { Match, PublicTeam, TournamentStatus } from './types'

interface CalendarTournament {
  id: number
  slug: string
  title: string
  status: TournamentStatus
}

interface TournamentCalendarInput {
  tournament: CalendarTournament
  matches: readonly Match[]
  teams: readonly PublicTeam[]
  origin: string
  team?: PublicTeam | null
  generatedAt: Date
}

export function parseCalendarTeamId(selector: string) {
  const value = selector.trim()
  if (!/^[1-9]\d*$/.test(value)) return null

  const id = Number(value)
  if (!Number.isSafeInteger(id)) return null
  return id
}

export function buildTournamentCalendar({
  tournament,
  matches,
  teams,
  origin,
  team,
  generatedAt,
}: TournamentCalendarInput) {
  const site = new URL(origin)
  const entries = buildScheduleEntries(matches, teams, 0).filter(
    entry =>
      entry.scheduledTime !== null && (!team || entry.a?.id === team.id || entry.b?.id === team.id),
  )

  return serializeICalendar({
    name: team ? `${tournament.title} · ${team.name}` : tournament.title,
    generatedAt,
    events: entries.map(entry => ({
      uid: `match-${entry.match.id}.tournament-${tournament.id}@${site.host.toLowerCase()}`,
      startsAt: new Date(entry.scheduledTime!),
      summary: `${entry.a?.name ?? '待定'} vs ${entry.b?.name ?? '待定'} · ${entry.match.roundLabel}`,
      description: `${tournament.title}\n${entry.match.roundLabel} · BO${entry.match.bestOf}`,
      url: new URL(
        `/tournaments/${encodeURIComponent(tournament.slug)}/matches/${entry.match.id}`,
        site.origin,
      ).toString(),
      status:
        entry.status === 'completed'
          ? 'CONFIRMED'
          : tournament.status === 'postponed' || !entry.a || !entry.b
            ? 'TENTATIVE'
            : 'CONFIRMED',
    })),
  })
}

function safeFilenamePart(value: string, fallback: string) {
  const safe = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .slice(0, 80)
  return safe || fallback
}

export function tournamentCalendarFilename(
  tournament: CalendarTournament,
  team?: PublicTeam | null,
) {
  const tournamentPart = safeFilenamePart(tournament.slug, `tournament-${tournament.id}`)
  const teamPart = team ? `-${safeFilenamePart(team.tag, `team-${team.id}`)}` : ''
  return `${tournamentPart}${teamPart}-calendar.ics`
}
