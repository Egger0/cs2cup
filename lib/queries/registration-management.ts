import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings'
import { hashRegistrationToken } from '../registration-access'
import { registrationAvailability, type RegistrationRosterPlayer } from '../registration'
import type { PublicTeam, TeamStatus, TournamentStatus } from '../types'

interface ManagedRegistrationRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  status: TeamStatus
  seed: number | null
  management_revision: number
  management_write_nonce: string | null
  created_at: string
  tournament_slug: string
  tournament_title: string
  tournament_status: TournamentStatus
  reg_deadline: string | null
  now_ms: number
}

interface ManagedPlayerRow {
  id: number
  team_id: number
  nickname: string
  role: string | null
  is_substitute: number
  sort_order: number
}

interface ManagedRegistrationValues {
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
}

export class RegistrationManagementError extends Error {
  readonly code: 'invalid_token' | 'locked' | 'duplicate' | 'conflict'

  constructor(code: RegistrationManagementError['code']) {
    super(code)
    this.name = 'RegistrationManagementError'
    this.code = code
  }
}

function mapRegistration(
  row: ManagedRegistrationRow,
  players: ManagedPlayerRow[],
): ManagedRegistration {
  const window = registrationAvailability(
    {
      status: row.tournament_status,
      regDeadline: row.reg_deadline,
      teamCap: 1,
    },
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
    editable: row.status === 'pending' && window.open,
  }
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
const MANAGED_TEAM_GUARD =
  "team.id = ? AND team.management_token_hash = ? AND team.status = 'pending' AND EXISTS (SELECT 1 FROM tournament WHERE tournament.id = team.tournament_id AND tournament.slug = ? AND tournament.status IN ('registration','postponed') AND (tournament.reg_deadline IS NULL OR unixepoch(tournament.reg_deadline) > unixepoch('now')))"
const DUPLICATE_TEAM_GUARD =
  'NOT EXISTS (SELECT 1 FROM team AS duplicate WHERE duplicate.tournament_id = team.tournament_id AND duplicate.id != team.id AND (LOWER(duplicate.name) = LOWER(?) OR UPPER(duplicate.tag) = ?))'
const CURRENT_TEAM_GUARD =
  'team.name = ? AND team.tag = ? AND team.captain = ? AND team.contact = ? AND team.dept IS ? AND team.note IS ?'
const CURRENT_REVISION_GUARD = 'team.management_revision = ?'
const CURRENT_WRITE_GUARD = 'team.management_write_nonce = ?'

async function registrationRowByHash(slug: string, tokenHash: string) {
  return cloudflareBindings()
    .db.prepare(
      "SELECT team.id, team.tournament_id, team.name, team.tag, team.captain, team.contact, team.dept, team.note, team.status, team.seed, team.management_revision, team.management_write_nonce, team.created_at, tournament.slug AS tournament_slug, tournament.title AS tournament_title, tournament.status AS tournament_status, tournament.reg_deadline, unixepoch('now') * 1000 AS now_ms FROM team JOIN tournament ON tournament.id = team.tournament_id WHERE tournament.slug = ? AND team.management_token_hash = ?",
    )
    .bind(slug, tokenHash)
    .first<ManagedRegistrationRow>()
}

async function registrationRow(slug: string, token: string) {
  if (!SLUG_PATTERN.test(slug)) return null
  const tokenHash = await hashRegistrationToken(token)
  return tokenHash ? registrationRowByHash(slug, tokenHash) : null
}

async function registrationPlayers(teamId: number) {
  return (
    await cloudflareBindings()
      .db.prepare(
        'SELECT id, team_id, nickname, role, is_substitute, sort_order FROM player WHERE team_id = ? ORDER BY sort_order',
      )
      .bind(teamId)
      .all<ManagedPlayerRow>()
  ).results
}

export async function getManagedRegistration(slug: string, token: string) {
  const row = await registrationRow(slug, token)
  if (!row) return null
  return mapRegistration(row, await registrationPlayers(row.id))
}

function managedGuardBindings(row: ManagedRegistrationRow, tokenHash: string, slug: string) {
  return [row.id, tokenHash, slug]
}

function currentTeamBindings(values: Omit<ManagedRegistrationValues, 'players'>) {
  return [values.name, values.tag, values.captain, values.contact, values.dept, values.note]
}

function duplicateGuardBindings(values: ManagedRegistrationValues) {
  return [values.name, values.tag]
}

function samePlayers(players: ManagedPlayerRow[], expected: RegistrationRosterPlayer[]) {
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

export async function saveManagedRegistration(
  slug: string,
  token: string,
  expectedRevision: number,
  values: ManagedRegistrationValues,
) {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RegistrationManagementError('conflict')
  }
  if (!SLUG_PATTERN.test(slug)) throw new RegistrationManagementError('invalid_token')
  const tokenHash = await hashRegistrationToken(token)
  if (!tokenHash) throw new RegistrationManagementError('invalid_token')
  const row = await registrationRowByHash(slug, tokenHash)
  if (!row) throw new RegistrationManagementError('invalid_token')
  const registration = mapRegistration(row, [])
  if (!registration.editable) throw new RegistrationManagementError('locked')
  if (row.management_revision !== expectedRevision) {
    throw new RegistrationManagementError('conflict')
  }

  const db = cloudflareBindings().db
  const duplicate = await db
    .prepare(
      'SELECT id FROM team WHERE tournament_id = ? AND id != ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
    )
    .bind(row.tournament_id, row.id, values.name, values.tag)
    .first<{ id: number }>()
  if (duplicate) throw new RegistrationManagementError('duplicate')

  const access = managedGuardBindings(row, tokenHash, slug)
  const updated = currentTeamBindings(values)
  const noDuplicate = duplicateGuardBindings(values)
  const nextRevision = expectedRevision + 1
  const writeNonce = crypto.randomUUID()
  const updatedTeamGuard = `${MANAGED_TEAM_GUARD} AND ${CURRENT_REVISION_GUARD} AND ${CURRENT_WRITE_GUARD} AND ${CURRENT_TEAM_GUARD} AND ${DUPLICATE_TEAM_GUARD}`

  try {
    await db.batch([
      db
        .prepare(
          `UPDATE team SET name = ?, tag = ?, captain = ?, contact = ?, dept = ?, note = ?, management_revision = ?, management_write_nonce = ? WHERE ${MANAGED_TEAM_GUARD} AND ${CURRENT_REVISION_GUARD} AND ${DUPLICATE_TEAM_GUARD}`,
        )
        .bind(...updated, nextRevision, writeNonce, ...access, expectedRevision, ...noDuplicate),
      db
        .prepare(
          `DELETE FROM player WHERE team_id = ? AND EXISTS (SELECT 1 FROM team WHERE ${updatedTeamGuard})`,
        )
        .bind(row.id, ...access, nextRevision, writeNonce, ...updated, ...noDuplicate),
      ...values.players.map((player, index) =>
        db
          .prepare(
            `INSERT INTO player (team_id,nickname,is_substitute,sort_order) SELECT team.id,?,?,? FROM team WHERE ${updatedTeamGuard}`,
          )
          .bind(
            player.nickname,
            player.substitute ? 1 : 0,
            index + 1,
            ...access,
            nextRevision,
            writeNonce,
            ...updated,
            ...noDuplicate,
          ),
      ),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('registration revision conflict')) {
      throw new RegistrationManagementError('conflict')
    }
    if (message.includes('UNIQUE constraint failed')) {
      throw new RegistrationManagementError('duplicate')
    }
    throw error
  }

  const latest = await registrationRowByHash(slug, tokenHash)
  if (!latest) throw new RegistrationManagementError('invalid_token')
  if (!mapRegistration(latest, []).editable) throw new RegistrationManagementError('locked')
  const latestValues = currentTeamBindings(latest)
  const players = await registrationPlayers(row.id)
  if (
    latest.management_revision !== nextRevision ||
    latest.management_write_nonce !== writeNonce ||
    latestValues.some((value, index) => value !== updated[index]) ||
    !samePlayers(players, values.players)
  ) {
    const nowDuplicate = await db
      .prepare(
        'SELECT id FROM team WHERE tournament_id = ? AND id != ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
      )
      .bind(row.tournament_id, row.id, values.name, values.tag)
      .first()
    throw new RegistrationManagementError(nowDuplicate ? 'duplicate' : 'conflict')
  }
  return { teamId: row.id, tournamentId: row.tournament_id, revision: nextRevision }
}
