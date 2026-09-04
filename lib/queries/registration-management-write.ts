import 'server-only'

import type { IdentityDatabase } from '../identity/internal/contracts'
import {
  CURRENT_REVISION_GUARD,
  CURRENT_TEAM_GUARD,
  CURRENT_WRITE_GUARD,
  currentTeamBindings,
  DUPLICATE_TEAM_GUARD,
  duplicateGuardBindings,
  EDITABLE_WINDOW_GUARD,
  mapRegistration,
  RegistrationManagementError,
  registrationPlayers,
  samePlayers,
  type ManagedRegistrationRow,
  type ManagedRegistrationValues,
} from './registration-management-model'

export interface RegistrationWriteAccess {
  guard: string
  bindings: unknown[]
  missingCode: 'invalid_token' | 'forbidden'
  legacy: boolean
  reload(): Promise<ManagedRegistrationRow | null>
}

export async function saveRegistrationWithAccess(
  database: IdentityDatabase,
  row: ManagedRegistrationRow,
  expectedRevision: number,
  values: ManagedRegistrationValues,
  access: RegistrationWriteAccess,
) {
  if (
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0 ||
    expectedRevision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new RegistrationManagementError('conflict')
  }
  if (!mapRegistration(row, [], access.legacy).editable) {
    throw new RegistrationManagementError('locked')
  }
  if (row.management_revision !== expectedRevision) {
    throw new RegistrationManagementError('conflict')
  }

  const duplicate = await database
    .prepare(
      'SELECT id FROM team WHERE tournament_id = ? AND id != ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
    )
    .bind(row.tournament_id, row.id, values.name, values.tag)
    .first<{ id: number }>()
  if (duplicate) throw new RegistrationManagementError('duplicate')

  const updated = currentTeamBindings(values)
  const noDuplicate = duplicateGuardBindings(values)
  const nextRevision = expectedRevision + 1
  const writeNonce = crypto.randomUUID()
  const editableGuard = `${access.guard} AND ${EDITABLE_WINDOW_GUARD}`
  const updatedTeamGuard = `${editableGuard} AND ${CURRENT_REVISION_GUARD} AND ${CURRENT_WRITE_GUARD} AND ${CURRENT_TEAM_GUARD} AND ${DUPLICATE_TEAM_GUARD}`

  try {
    await database.batch([
      database
        .prepare(
          `UPDATE team SET name = ?, tag = ?, captain = ?, contact = ?, dept = ?, note = ?, management_revision = ?, management_write_nonce = ? WHERE ${editableGuard} AND ${CURRENT_REVISION_GUARD} AND ${DUPLICATE_TEAM_GUARD}`,
        )
        .bind(
          ...updated,
          nextRevision,
          writeNonce,
          ...access.bindings,
          expectedRevision,
          ...noDuplicate,
        ),
      database
        .prepare(
          `DELETE FROM player WHERE team_id = ? AND EXISTS (SELECT 1 FROM team WHERE ${updatedTeamGuard})`,
        )
        .bind(row.id, ...access.bindings, nextRevision, writeNonce, ...updated, ...noDuplicate),
      ...values.players.map((player, index) =>
        database
          .prepare(
            `INSERT INTO player (team_id,nickname,is_substitute,sort_order) SELECT team.id,?,?,? FROM team WHERE ${updatedTeamGuard}`,
          )
          .bind(
            player.nickname,
            player.substitute ? 1 : 0,
            index + 1,
            ...access.bindings,
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

  const latest = await access.reload()
  if (!latest) throw new RegistrationManagementError(access.missingCode)
  if (!mapRegistration(latest, [], access.legacy).editable) {
    throw new RegistrationManagementError('locked')
  }
  const latestValues = currentTeamBindings(latest)
  const players = await registrationPlayers(database, row.id)
  if (
    latest.management_revision !== nextRevision ||
    latest.management_write_nonce !== writeNonce ||
    latestValues.some((value, index) => value !== updated[index]) ||
    !samePlayers(players, values.players)
  ) {
    const nowDuplicate = await database
      .prepare(
        'SELECT id FROM team WHERE tournament_id = ? AND id != ? AND (LOWER(name) = LOWER(?) OR UPPER(tag) = ?)',
      )
      .bind(row.tournament_id, row.id, values.name, values.tag)
      .first()
    throw new RegistrationManagementError(nowDuplicate ? 'duplicate' : 'conflict')
  }
  return { teamId: row.id, tournamentId: row.tournament_id, revision: nextRevision }
}
