import type { Tournament, TournamentStatus } from './types.ts'

export const TOURNAMENT_STATES: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名中',
  running: '进行中',
  finished: '已结束',
  postponed: '延期中',
}
export interface TournamentFilters {
  q: string
  status: string
  game: string
  season: string
  followed: boolean
}

export function readTournamentFilters(
  query: Record<string, string | string[] | undefined>,
): TournamentFilters {
  const first = (key: string) => {
    const value = query[key]
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
  }
  const status = first('status')
  return {
    q: first('q').slice(0, 80),
    status: ['registration', 'running', 'finished', 'postponed'].includes(status) ? status : 'all',
    game: first('game').slice(0, 80),
    season: first('season').slice(0, 40),
    followed: first('followed') === '1',
  }
}

export function tournamentFilterHref(filters: TournamentFilters) {
  const query = new URLSearchParams()
  if (filters.q) query.set('q', filters.q)
  if (filters.status !== 'all') query.set('status', filters.status)
  if (filters.game) query.set('game', filters.game)
  if (filters.season) query.set('season', filters.season)
  if (filters.followed) query.set('followed', '1')
  return `/tournaments${query.size ? `?${query}` : ''}`
}

export function filterTournaments(
  tournaments: readonly Tournament[],
  filters: TournamentFilters,
  followedIds: readonly number[] = [],
) {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase()
  const terms = normalize(filters.q).split(/\s+/).filter(Boolean)
  return tournaments.filter(tournament => {
    const haystack = normalize(
      [
        tournament.title,
        tournament.gameName,
        tournament.gameSlug,
        tournament.season,
        tournament.slug,
      ].join(' '),
    )
    return (
      tournament.status !== 'draft' &&
      (filters.status === 'all' || tournament.status === filters.status) &&
      (!filters.game || tournament.gameSlug === filters.game) &&
      (!filters.season || tournament.season === filters.season) &&
      (!filters.followed || followedIds.includes(tournament.id)) &&
      terms.every(term => haystack.includes(term))
    )
  })
}
