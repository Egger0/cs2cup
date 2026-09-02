import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings.ts'
import { buildScheduleEntries, selectNextScheduleEntry, type ScheduleStatus } from '../schedule.ts'
import type { Match, PublicTeam } from '../types.ts'

interface ParticipantScheduleTeamRow {
  id: number
  tournament_id: number
  tournament_slug: string
  tournament_title: string
  name: string
  tag: string
  captain: string
  dept: string | null
  seed: number | null
  owned: number
}

interface ParticipantScheduleMatchRow {
  id: number
  tournament_id: number
  round: number
  slot: number
  round_label: string
  best_of: number
  team_a_id: number | null
  team_b_id: number | null
  source_match_a_id: number | null
  source_match_b_id: number | null
  score_a: number | null
  score_b: number | null
  winner_team_id: number | null
  scheduled_at: string | null
}

export interface ParticipantNextMatchDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>
    }
  }
}

export interface ParticipantNextMatch {
  tournament: {
    id: number
    slug: string
    title: string
  }
  ownedTeam: {
    id: number
    name: string
    tag: string
  }
  match: {
    id: number
    roundLabel: string
    bestOf: number
    scheduledAt: string | null
    status: ScheduleStatus
    teamA: { id: number; name: string; tag: string } | null
    teamB: { id: number; name: string; tag: string } | null
  }
}

function scheduleTeam(row: ParticipantScheduleTeamRow): PublicTeam {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    tag: row.tag,
    captain: row.captain,
    dept: row.dept,
    seed: row.seed,
    players: [],
  }
}

function scheduleMatch(row: ParticipantScheduleMatchRow): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    round: row.round,
    slot: row.slot,
    roundLabel: row.round_label,
    bestOf: row.best_of,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    sourceMatchAId: row.source_match_a_id,
    sourceMatchBId: row.source_match_b_id,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerTeamId: row.winner_team_id,
    scheduledAt: row.scheduled_at,
  }
}

export async function participantNextMatchFromDatabase(
  db: ParticipantNextMatchDatabase,
  principalId: string,
  now = Date.now(),
): Promise<ParticipantNextMatch | null> {
  const participantTournamentIds = `SELECT owned_team.tournament_id
    FROM tournament_entry_owner AS owned_entry
    JOIN team AS owned_team ON owned_team.id = owned_entry.team_id
    JOIN tournament AS owned_tournament ON owned_tournament.id = owned_team.tournament_id
    WHERE owned_entry.principal_id = ?
      AND owned_tournament.status IN ('registration', 'running')`
  const [teamResult, matchResult] = await Promise.all([
    db
      .prepare(
        `SELECT
          public_team.id,
          public_team.tournament_id,
          tournament.slug AS tournament_slug,
          tournament.title AS tournament_title,
          public_team.name,
          public_team.tag,
          public_team.captain,
          public_team.dept,
          public_team.seed,
          CASE WHEN owner.principal_id IS NULL THEN 0 ELSE 1 END AS owned
        FROM team_public AS public_team
        JOIN tournament ON tournament.id = public_team.tournament_id
        LEFT JOIN tournament_entry_owner AS owner
          ON owner.team_id = public_team.id AND owner.principal_id = ?
        WHERE public_team.tournament_id IN (${participantTournamentIds})
        ORDER BY public_team.tournament_id, public_team.seed, public_team.id`,
      )
      .bind(principalId, principalId)
      .all<ParticipantScheduleTeamRow>(),
    db
      .prepare(
        `SELECT
          id,
          tournament_id,
          round,
          slot,
          round_label,
          best_of,
          team_a_id,
          team_b_id,
          source_match_a_id,
          source_match_b_id,
          score_a,
          score_b,
          winner_team_id,
          scheduled_at
        FROM match_public
        WHERE tournament_id IN (${participantTournamentIds})
        ORDER BY tournament_id, round, slot, id`,
      )
      .bind(principalId)
      .all<ParticipantScheduleMatchRow>(),
  ])
  const teamsByTournament = new Map<number, PublicTeam[]>()
  const ownedTeams: ParticipantScheduleTeamRow[] = []

  for (const row of teamResult.results) {
    const teams = teamsByTournament.get(row.tournament_id)
    if (teams) teams.push(scheduleTeam(row))
    else teamsByTournament.set(row.tournament_id, [scheduleTeam(row)])
    if (row.owned === 1) ownedTeams.push(row)
  }

  const matchesByTournament = new Map<number, Match[]>()
  for (const row of matchResult.results) {
    const matches = matchesByTournament.get(row.tournament_id)
    if (matches) matches.push(scheduleMatch(row))
    else matchesByTournament.set(row.tournament_id, [scheduleMatch(row)])
  }

  const candidates = ownedTeams.flatMap(owned => {
    const entries = buildScheduleEntries(
      matchesByTournament.get(owned.tournament_id) ?? [],
      teamsByTournament.get(owned.tournament_id) ?? [],
      now,
    ).filter(entry => entry.a?.id === owned.id || entry.b?.id === owned.id)
    const entry = selectNextScheduleEntry(entries, now)
    return entry ? [{ entry, owned }] : []
  })
  const selected = selectNextScheduleEntry(
    candidates.map(candidate => candidate.entry),
    now,
  )
  const candidate = candidates.find(value => value.entry === selected)
  if (!selected || !candidate) return null

  const summaryTeam = (team: PublicTeam | null) =>
    team ? { id: team.id, name: team.name, tag: team.tag } : null

  return {
    tournament: {
      id: candidate.owned.tournament_id,
      slug: candidate.owned.tournament_slug,
      title: candidate.owned.tournament_title,
    },
    ownedTeam: {
      id: candidate.owned.id,
      name: candidate.owned.name,
      tag: candidate.owned.tag,
    },
    match: {
      id: selected.match.id,
      roundLabel: selected.match.roundLabel,
      bestOf: selected.match.bestOf,
      scheduledAt: selected.match.scheduledAt,
      status: selected.status,
      teamA: summaryTeam(selected.a),
      teamB: summaryTeam(selected.b),
    },
  }
}

export function participantNextMatch(principalId: string, now = Date.now()) {
  return participantNextMatchFromDatabase(cloudflareBindings().db, principalId, now)
}
