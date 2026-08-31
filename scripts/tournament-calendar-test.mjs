import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const source = path => new URL(path, import.meta.url).href
const publicQueriesModule = `data:text/javascript,${encodeURIComponent(`
  export async function getTournament() {
    if (globalThis.__calendarFailure) throw globalThis.__calendarFailure
    return globalThis.__calendarTournament
  }
  export async function getPublicTeams() { return globalThis.__calendarTeams }
  export async function getMatches() { return globalThis.__calendarMatches }
`)}`
const siteConfigModule =
  'data:text/javascript,export function resolveSiteOrigin(){return "https://cup.example"}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/queries/public') {
      return { url: publicQueriesModule, shortCircuit: true }
    }
    if (specifier === '@/lib/site-config') {
      return { url: siteConfigModule, shortCircuit: true }
    }
    if (specifier === '@/lib/tournament-calendar') {
      return { url: source('../lib/tournament-calendar.ts'), shortCircuit: true }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { buildTournamentCalendar, parseCalendarTeamId, tournamentCalendarFilename } =
  await import('../lib/tournament-calendar.ts')

const generatedAt = new Date('2026-01-02T03:04:05Z')
const tournamentId = 7
const tournament = {
  id: tournamentId,
  slug: 'autumn-cup',
  title: 'Autumn Cup',
  status: 'running',
}
const team = (id, tag) => ({
  id,
  tournamentId,
  name: `Team ${tag}`,
  tag,
  captain: `Captain ${tag}`,
  dept: null,
  seed: id,
  players: [],
})
const match = (id, overrides = {}) => ({
  id,
  tournamentId,
  round: 0,
  slot: id,
  roundLabel: 'Opening round',
  bestOf: 3,
  teamAId: 1,
  teamBId: 2,
  sourceMatchAId: null,
  sourceMatchBId: null,
  scoreA: null,
  scoreB: null,
  winnerTeamId: null,
  scheduledAt: null,
  ...overrides,
})

const teams = [team(1, 'ONE'), team(2, 'TWO'), team(3, 'THREE')]
const opening = match(11, {
  scheduledAt: '2026-11-15T06:00:00Z',
  scoreA: 2,
  scoreB: 0,
  winnerTeamId: 1,
})
const laterRound = match(21, {
  round: 1,
  slot: 0,
  roundLabel: 'Final',
  teamAId: null,
  teamBId: 3,
  sourceMatchAId: 14,
  scheduledAt: '2026-11-16T08:00:00Z',
})
const bye = match(12, { teamBId: null, winnerTeamId: 1, scheduledAt: '2026-11-15T07:00:00Z' })
const invalid = match(13, { scheduledAt: '2026-02-30T12:00:00Z' })
const unscheduled = match(14)
const matches = [laterRound, invalid, unscheduled, bye, opening]

assert.equal(parseCalendarTeamId('1'), 1)
assert.equal(parseCalendarTeamId('three'), null)
assert.equal(parseCalendarTeamId(''), null)
assert.equal(parseCalendarTeamId('0'), null)

const fullCalendar = buildTournamentCalendar({
  tournament,
  matches,
  teams,
  origin: 'https://cup.example',
  generatedAt,
})
assert.equal(fullCalendar.match(/BEGIN:VEVENT/g)?.length, 2)
assert.match(fullCalendar, /DTSTAMP:20260102T030405Z/)
assert.match(fullCalendar, /DTSTART:20261115T060000Z/)
assert.match(fullCalendar, /DTSTART:20261116T080000Z/)
assert.doesNotMatch(fullCalendar, /match-(?:12|13|14)\./)
assert.match(fullCalendar, /UID:match-11\.tournament-7@cup\.example/)
assert.match(fullCalendar, /URL:https:\/\/cup\.example\/tournaments\/autumn-cup\/matches\/21/)
assert.match(fullCalendar, /match-21[\s\S]*STATUS:TENTATIVE/)

const teamCalendar = buildTournamentCalendar({
  tournament,
  matches,
  teams,
  team: teams[2],
  origin: 'https://cup.example',
  generatedAt,
})
assert.equal(teamCalendar.match(/BEGIN:VEVENT/g)?.length, 1)
assert.match(teamCalendar, /match-21/)
assert.match(teamCalendar, /X-WR-CALNAME:Autumn Cup · Team THREE/)

const postponedCalendar = buildTournamentCalendar({
  tournament: { ...tournament, status: 'postponed' },
  matches: [opening, match(15, { scheduledAt: '2026-11-17T08:00:00Z' })],
  teams,
  origin: 'https://cup.example',
  generatedAt,
})
assert.equal(postponedCalendar.match(/STATUS:CONFIRMED/g)?.length, 1)
assert.equal(postponedCalendar.match(/STATUS:TENTATIVE/g)?.length, 1)

assert.equal(tournamentCalendarFilename(tournament), 'autumn-cup-calendar.ics')
assert.equal(
  tournamentCalendarFilename({ ...tournament, id: 8, slug: '../\r\n"' }, teams[2]),
  'tournament-8-THREE-calendar.ics',
)

const { GET } = await import('../app/(public)/tournaments/[slug]/calendar.ics/route.ts')
const request = query =>
  new Request(`https://request.example/tournaments/autumn-cup/calendar.ics${query}`)

globalThis.__calendarTournament = null
globalThis.__calendarTeams = teams
globalThis.__calendarMatches = matches
globalThis.__calendarFailure = null

{
  const response = await GET(request(''), { params: Promise.resolve({ slug: 'missing' }) })
  assert.equal(response.status, 404)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
}

globalThis.__calendarTournament = tournament

{
  globalThis.__calendarFailure = new Error('database unavailable')
  const originalError = console.error
  console.error = () => {}
  try {
    const response = await GET(request(''), {
      params: Promise.resolve({ slug: tournament.slug }),
    })
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(await response.text(), /BEGIN:VCALENDAR/)
  } finally {
    console.error = originalError
    globalThis.__calendarFailure = null
  }
}

{
  const response = await GET(request('?teamId='), {
    params: Promise.resolve({ slug: tournament.slug }),
  })
  assert.equal(response.status, 400)
}

{
  const response = await GET(request('?teamId=1&teamId=2'), {
    params: Promise.resolve({ slug: tournament.slug }),
  })
  assert.equal(response.status, 400)
}

{
  const response = await GET(request('?teamId=99'), {
    params: Promise.resolve({ slug: tournament.slug }),
  })
  assert.equal(response.status, 404)
}

{
  globalThis.__calendarMatches = []
  const response = await GET(request(''), {
    params: Promise.resolve({ slug: tournament.slug }),
  })
  assert.equal(response.status, 200)
  assert.doesNotMatch(await response.text(), /BEGIN:VEVENT/)
}

{
  globalThis.__calendarMatches = matches
  const response = await GET(request('?teamId=3'), {
    params: Promise.resolve({ slug: tournament.slug }),
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8')
  assert.equal(
    response.headers.get('cache-control'),
    'public, max-age=0, s-maxage=300, must-revalidate',
  )
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="autumn-cup-THREE-calendar.ics"',
  )
  const body = await response.text()
  assert.equal(body.match(/BEGIN:VEVENT/g)?.length, 1)
  assert.match(body, /match-21/)
  assert.match(body, /URL:https:\/\/cup\.example\//)
  assert.doesNotMatch(body, /request\.example/)
}

console.log('Tournament calendar tests passed')
