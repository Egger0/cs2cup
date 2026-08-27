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

export function decideWinner(match: Match): number | null {
  if (match.scoreA === null || match.scoreB === null) return null
  const target = winsNeeded(match.bestOf)
  if (match.scoreA >= target && match.scoreA > match.scoreB) return match.teamAId
  if (match.scoreB >= target && match.scoreB > match.scoreA) return match.teamBId
  return null
}

export function isCompletedMatch(match: Match) {
  return match.winnerTeamId !== null && match.scoreA !== null && match.scoreB !== null
}

export function isByeMatch(match: Match) {
  return (
    match.winnerTeamId !== null &&
    match.scoreA === null &&
    match.scoreB === null &&
    ((match.teamAId === null) !== (match.teamBId === null))
  )
}

export function nextPlayableMatch(
  matches: Match[],
  teams: Map<number, PublicTeam>,
): ResolvedMatch | null {
  const index = indexMatches(matches)
  const ordered = [...matches].sort((x, y) => x.round - y.round || x.slot - y.slot)
  for (const match of ordered) {
    if (match.winnerTeamId !== null) continue
    const resolved = resolveMatch(match, index, teams)
    if (resolved.a && resolved.b) return resolved
  }
  return null
}

export function downstreamOf(matchId: number, matches: Match[]): number[] {
  const affected: number[] = []
  const queue = [matchId]
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const match of matches) {
      if (match.sourceMatchAId === current || match.sourceMatchBId === current) {
        affected.push(match.id)
        queue.push(match.id)
      }
    }
  }
  return affected
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
