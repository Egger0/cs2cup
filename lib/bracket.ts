import type { Match, PublicTeam } from './types'

export interface ResolvedMatch {
  match: Match
  a: PublicTeam | null
  b: PublicTeam | null
  winner: PublicTeam | null
}

export function indexMatches(matches: Match[]) {
  return new Map(matches.map(match => [match.id, match]))
}

export function indexTeams(teams: PublicTeam[]) {
  return new Map(teams.map(team => [team.id, team]))
}

function side(
  teamId: number | null,
  sourceId: number | null,
  matches: Map<number, Match>,
  teams: Map<number, PublicTeam>,
): PublicTeam | null {
  if (teamId !== null) return teams.get(teamId) ?? null
  if (sourceId === null) return null
  const source = matches.get(sourceId)
  if (!source?.winnerTeamId) return null
  return teams.get(source.winnerTeamId) ?? null
}

export function resolveMatch(
  match: Match,
  matches: Map<number, Match>,
  teams: Map<number, PublicTeam>,
): ResolvedMatch {
  return {
    match,
    a: side(match.teamAId, match.sourceMatchAId, matches, teams),
    b: side(match.teamBId, match.sourceMatchBId, matches, teams),
    winner: match.winnerTeamId ? (teams.get(match.winnerTeamId) ?? null) : null,
  }
}

export function winsNeeded(bestOf: number) {
  return Math.floor(bestOf / 2) + 1
}

export function isCompletedMatch(match: Match) {
  return match.winnerTeamId !== null && match.scoreA !== null && match.scoreB !== null
}

export function isByeMatch(match: Match) {
  return (
    match.round === 0 &&
    match.sourceMatchAId === null &&
    match.sourceMatchBId === null &&
    match.winnerTeamId !== null &&
    match.scoreA === null &&
    match.scoreB === null &&
    (match.teamAId === null) !== (match.teamBId === null)
  )
}

export function groupByRound(matches: Match[]) {
  const rounds = new Map<number, { label: string; matches: Match[] }>()
  for (const match of [...matches].sort((x, y) => x.round - y.round || x.slot - y.slot)) {
    const bucket = rounds.get(match.round)
    if (bucket) bucket.matches.push(match)
    else rounds.set(match.round, { label: match.roundLabel, matches: [match] })
  }
  return [...rounds.entries()]
    .sort(([x], [y]) => x - y)
    .map(([round, bucket]) => ({ round, ...bucket }))
}
