import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'
import {
  buildTournamentCalendar,
  parseCalendarTeamId,
  tournamentCalendarFilename,
} from '@/lib/tournament-calendar'

export const revalidate = 300

const ERROR_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
}

function problem(message: string, status: number) {
  return new Response(message, { status, headers: ERROR_HEADERS })
}

async function calendarResponse(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) return problem('Tournament not found', 404)

  const teamSelectors = new URL(request.url).searchParams.getAll('teamId')
  if (teamSelectors.length > 1) return problem('Invalid team selector', 400)
  const teamId = teamSelectors[0] === undefined ? null : parseCalendarTeamId(teamSelectors[0])
  if (teamSelectors.length === 1 && teamId === null) {
    return problem('Invalid team selector', 400)
  }

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])
  const team = teamId === null ? null : (teams.find(entry => entry.id === teamId) ?? null)
  if (teamId !== null && !team) return problem('Team not found', 404)

  const calendar = buildTournamentCalendar({
    tournament,
    matches,
    teams,
    team,
    origin: resolveSiteOrigin(),
    generatedAt: new Date(),
  })
  const filename = tournamentCalendarFilename(tournament, team)

  return new Response(calendar, {
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=300, must-revalidate',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'text/calendar; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    return await calendarResponse(request, context)
  } catch (error) {
    console.error('calendar export failed', error)
    return problem('Calendar unavailable', 503)
  }
}
