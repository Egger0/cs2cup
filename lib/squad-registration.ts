import 'server-only'

import type { AuthenticatedAuthContext, IdentityDatabase } from './identity/internal/contracts.ts'
import { createApprovedTournamentRegistration } from './identity/tournament-registration.ts'
import { registrationAvailability, validateRegistrationRoster } from './registration.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

const LIMITS = { contact: [1, 40], dept: [0, 30], note: [0, 120] } as const

export interface SquadTournament {
  readonly id: number
  readonly slug: string
  readonly title: string
  readonly regDeadline: string | null
  readonly teamId: number | null
  readonly teamStatus: 'pending' | 'approved' | 'rejected' | null
}

export type SquadRegistrationFailure =
  | 'invalid_details'
  | 'not_captain'
  | 'not_full'
  | 'closed'
  | 'taken'
  | 'duplicate_nicknames'
  | 'authorization_changed'

export function parseSquadRegistrationDetails(source: Record<string, unknown>) {
  const details = {} as Record<keyof typeof LIMITS, string>
  for (const [field, [min, max]] of Object.entries(LIMITS) as [
    keyof typeof LIMITS,
    readonly [number, number],
  ][]) {
    const value = typeof source[field] === 'string' ? source[field].trim() : ''
    if ([...value].length < min || [...value].length > max || CONTROL_CHARACTER.test(value))
      return null
    details[field] = value
  }
  return details
}

export async function squadTournaments(
  database: IdentityDatabase,
  squad: { id: string; gameId: number },
): Promise<SquadTournament[]> {
  const { results } = await database
    .prepare(
      `SELECT tournament.id, tournament.slug, tournament.title,
              tournament.reg_deadline AS regDeadline, team.id AS teamId, team.status AS teamStatus
       FROM tournament
       LEFT JOIN squad_registration AS registration
         ON registration.tournament_id = tournament.id AND registration.squad_id = ?
       LEFT JOIN team ON team.id = registration.team_id
       WHERE tournament.game_id = ? AND tournament.status != 'draft' AND (
         registration.team_id IS NOT NULL OR (
           tournament.status IN ('registration', 'postponed')
           AND (tournament.reg_deadline IS NULL
             OR unixepoch(tournament.reg_deadline) > unixepoch('now'))
         )
       )
       ORDER BY tournament.season DESC, tournament.edition DESC`,
    )
    .bind(squad.id, squad.gameId)
    .all<SquadTournament>()
  return results
}

export async function registerSquad(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: {
    squadId: string
    tournamentId: number
    details: { contact: string; dept: string; note: string }
    fingerprint: string
    managementTokenHash: string
    now: number
  },
): Promise<{ ok: true; teamId: number } | { ok: false; reason: SquadRegistrationFailure }> {
  const { results: members } = await database
    .prepare(
      `SELECT squad.name, squad.tag, squad.game_id AS gameId, game.roster_size AS rosterSize,
              member.account_id AS accountId, account.display_name AS displayName
       FROM squad
       JOIN game ON game.id = squad.game_id
       JOIN squad_member AS member ON member.squad_id = squad.id
       JOIN identity_account AS account ON account.id = member.account_id
       WHERE squad.id = ? AND squad.captain_account_id = ?
       ORDER BY member.account_id = squad.captain_account_id DESC, member.joined_at ASC`,
    )
    .bind(input.squadId, context.account.id)
    .all<{
      name: string
      tag: string
      gameId: number
      rosterSize: number
      accountId: string
      displayName: string
    }>()
  const [captain] = members
  if (!captain) return { ok: false, reason: 'not_captain' }
  if (members.length !== captain.rosterSize) return { ok: false, reason: 'not_full' }

  const tournament = await database
    .prepare(
      `SELECT tournament.status, tournament.reg_deadline AS regDeadline,
              tournament.team_cap AS teamCap, unixepoch('now') * 1000 AS nowMs,
              (SELECT COUNT(*) FROM team WHERE tournament_id = tournament.id
                 AND status != 'rejected') AS taken,
              EXISTS (SELECT 1 FROM team WHERE tournament_id = tournament.id
                 AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)) AS duplicate
       FROM tournament WHERE id = ? AND game_id = ?`,
    )
    .bind(captain.name, captain.tag, input.tournamentId, captain.gameId)
    .first<{
      status: string
      regDeadline: string | null
      teamCap: number
      nowMs: number
      taken: number
      duplicate: number
    }>()
  if (!tournament) return { ok: false, reason: 'closed' }
  if (!registrationAvailability(tournament, tournament.taken, tournament.nowMs).open) {
    return { ok: false, reason: 'closed' }
  }
  if (tournament.duplicate) return { ok: false, reason: 'taken' }

  const roster = validateRegistrationRoster(
    members.map(member => ({
      nickname: [...member.displayName].slice(0, 20).join(''),
      substitute: false,
    })),
    captain.rosterSize,
  )
  if (!roster.ok) return { ok: false, reason: 'duplicate_nicknames' }

  const created = await createApprovedTournamentRegistration(database, context, {
    tournamentId: input.tournamentId,
    team: {
      name: captain.name,
      tag: captain.tag,
      captain: [...captain.displayName].slice(0, 20).join(''),
      ...input.details,
      players: roster.players,
    },
    managementTokenHash: input.managementTokenHash,
    fingerprint: input.fingerprint,
    now: input.now,
    squad: { id: input.squadId, playerAccountIds: members.map(member => member.accountId) },
  })
  if (!created.ok) {
    return {
      ok: false,
      reason: created.reason === 'authorization_changed' ? 'authorization_changed' : 'closed',
    }
  }
  return { ok: true, teamId: created.teamId }
}
