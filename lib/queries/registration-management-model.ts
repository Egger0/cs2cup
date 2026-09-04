import 'server-only'

import type { IdentityDatabase } from '../identity/internal/contracts'
import { registrationAvailability, type RegistrationRosterPlayer } from '../registration'
import type { PublicTeam, TeamStatus, TournamentStatus } from '../types'

export interface ManagedRegistrationRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  status: TeamStatus
  checked_in_at: string | null
  seed: number | null
  management_revision: number
  management_write_nonce: string | null
  created_at: string
  tournament_slug: string
  tournament_title: string
  tournament_status: TournamentStatus
  reg_deadline: string | null
  now_ms: number
  identity_owner_account_id: string | null
}

export interface AccountManagedRegistrationRow extends ManagedRegistrationRow {
  access_id: string
  access_revision: number
  relationship: 'owner' | 'manager'
}

export interface ManagedPlayerRow {
  id: number
  team_id: number
  nickname: string
  role: string | null
  is_substitute: number
  sort_order: number
}

export interface ManagedRegistrationValues {
  name: string
  tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  players: RegistrationRosterPlayer[]
}

export interface ManagedRegistrationTeam extends PublicTeam {
  contact: string
  note: string | null
  status: TeamStatus
  checkedInAt: string | null
  createdAt: string
}

export interface ManagedRegistration {
  team: ManagedRegistrationTeam
  revision: number
  tournament: {
    id: number
    slug: string
    title: string
    status: TournamentStatus
    regDeadline: string | null
  }
  editable: boolean
  accountOwned: boolean
}

export interface AccountManagedRegistration extends ManagedRegistration {
  relationship: 'owner' | 'manager'
}

export class RegistrationManagementError extends Error {
  readonly code:
    | 'invalid_token'
    | 'forbidden'
    | 'reauth_required'
    | 'locked'
    | 'duplicate'
    | 'conflict'

  constructor(code: RegistrationManagementError['code']) {
    super(code)
    this.name = 'RegistrationManagementError'
    this.code = code
  }
}

export function mapRegistration(
  row: ManagedRegistrationRow,
  players: ManagedPlayerRow[],
  legacyAccess = false,
): ManagedRegistration {
  const window = registrationAvailability(
    { status: row.tournament_status, regDeadline: row.reg_deadline, teamCap: 1 },
    0,
    row.now_ms,
  )
  return {
    team: {
      id: row.id,
      tournamentId: row.tournament_id,
      name: row.name,
      tag: row.tag,
      captain: row.captain,
      contact: row.contact,
      dept: row.dept,
      note: row.note,
      status: row.status,
      checkedInAt: row.checked_in_at,
      seed: row.seed,
      createdAt: row.created_at,
      players: players.map(player => ({
        id: player.id,
        teamId: player.team_id,
        nickname: player.nickname,
        role: player.role,
        isSubstitute: player.is_substitute === 1,
        sortOrder: player.sort_order,
      })),
    },
    revision: row.management_revision,
    tournament: {
      id: row.tournament_id,
      slug: row.tournament_slug,
      title: row.tournament_title,
      status: row.tournament_status,
      regDeadline: row.reg_deadline,
    },
    editable:
      row.status === 'pending' && window.open && (!legacyAccess || !row.identity_owner_account_id),
    accountOwned: row.identity_owner_account_id !== null,
  }
}

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
export const REGISTRATION_SELECT = `SELECT team.id, team.tournament_id, team.name, team.tag,
  team.captain, team.contact, team.dept, team.note, team.status, team.checked_in_at,
  team.seed, team.management_revision, team.management_write_nonce, team.created_at,
  tournament.slug AS tournament_slug, tournament.title AS tournament_title,
  tournament.status AS tournament_status, tournament.reg_deadline,
  unixepoch('now') * 1000 AS now_ms,
  (SELECT account_id FROM identity_registration_membership AS owner
   WHERE owner.team_id = team.id AND owner.relationship = 'owner'
     AND owner.revoked_at IS NULL LIMIT 1) AS identity_owner_account_id
  FROM team JOIN tournament ON tournament.id = team.tournament_id`
export const EDITABLE_WINDOW_GUARD =
  "team.status = 'pending' AND EXISTS (SELECT 1 FROM tournament WHERE tournament.id = team.tournament_id AND tournament.status IN ('registration','postponed') AND (tournament.reg_deadline IS NULL OR unixepoch(tournament.reg_deadline) > unixepoch('now')))"
export const DUPLICATE_TEAM_GUARD =
  'NOT EXISTS (SELECT 1 FROM team AS duplicate WHERE duplicate.tournament_id = team.tournament_id AND duplicate.id != team.id AND (LOWER(duplicate.name) = LOWER(?) OR UPPER(duplicate.tag) = ?))'
export const CURRENT_TEAM_GUARD =
  'team.name = ? AND team.tag = ? AND team.captain = ? AND team.contact = ? AND team.dept IS ? AND team.note IS ?'
export const CURRENT_REVISION_GUARD = 'team.management_revision = ?'
export const CURRENT_WRITE_GUARD = 'team.management_write_nonce = ?'

export async function registrationRowByHash(
  database: IdentityDatabase,
  slug: string,
  tokenHash: string,
) {
  return database
    .prepare(`${REGISTRATION_SELECT} WHERE tournament.slug = ? AND team.management_token_hash = ?`)
    .bind(slug, tokenHash)
    .first<ManagedRegistrationRow>()
}

export async function registrationPlayers(database: IdentityDatabase, teamId: number) {
  return (
    await database
      .prepare(
        'SELECT id, team_id, nickname, role, is_substitute, sort_order FROM player WHERE team_id = ? ORDER BY sort_order',
      )
      .bind(teamId)
      .all<ManagedPlayerRow>()
  ).results
}

export function currentTeamBindings(values: Omit<ManagedRegistrationValues, 'players'>) {
  return [values.name, values.tag, values.captain, values.contact, values.dept, values.note]
}

export function duplicateGuardBindings(values: ManagedRegistrationValues) {
  return [values.name, values.tag]
}

export function samePlayers(players: ManagedPlayerRow[], expected: RegistrationRosterPlayer[]) {
  return (
    players.length === expected.length &&
    players.every(
      (player, index) =>
        player.nickname === expected[index]?.nickname &&
        (player.is_substitute === 1) === expected[index]?.substitute &&
        player.sort_order === index + 1,
    )
  )
}
