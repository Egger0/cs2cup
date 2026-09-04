import 'server-only'

import { requireAdmin } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import {
  isCheckInOperatorDuration,
  isCheckInOperatorSnapshot,
  isValidParticipantPrincipalId,
  isValidTournamentStaffId,
  maskParticipantPrincipal,
  type CheckInOperatorAssignmentSnapshot,
  type TournamentCheckInOperatorAssignment,
  type TournamentCheckInOperatorCandidate,
} from '../../tournament-staff-management'

export { getTournamentCheckInOperatorManager } from './tournament-staff-read'

export {
  CHECK_IN_OPERATOR_DURATIONS,
  type CheckInOperatorAssignment,
  type CheckInOperatorAssignmentSnapshot,
  type TournamentCheckInOperatorManager,
} from '../../tournament-staff-management'

interface AssignmentRow {
  principal_id: string
  granted_at: number
  expires_at: number | null
  revoked_at: number | null
}

function snapshot(row: AssignmentRow): CheckInOperatorAssignmentSnapshot {
  return {
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

function assignment(
  row: AssignmentRow,
  now: number,
  candidate?: TournamentCheckInOperatorCandidate,
): TournamentCheckInOperatorAssignment {
  const current = snapshot(row)
  return {
    principalId: row.principal_id,
    reference: maskParticipantPrincipal(row.principal_id),
    ...current,
    active: current.revokedAt === null && (current.expiresAt === null || current.expiresAt > now),
    team: candidate?.team ?? null,
    snapshot: current,
  }
}

export async function grantCheckInOperatorAssignment(
  tournamentId: number,
  principalId: string,
  durationHours: number,
  expectedSnapshot: CheckInOperatorAssignmentSnapshot | null,
): Promise<TournamentCheckInOperatorAssignment | null> {
  await requireAdmin()
  if (
    !isValidTournamentStaffId(tournamentId) ||
    !isValidParticipantPrincipalId(principalId) ||
    !isCheckInOperatorDuration(durationHours) ||
    (expectedSnapshot !== null && !isCheckInOperatorSnapshot(expectedSnapshot))
  ) {
    return null
  }

  const now = Date.now()
  const grantedAt = Math.max(now, (expectedSnapshot?.revokedAt ?? now - 1) + 1)
  const expiresAt = grantedAt + durationHours * 60 * 60 * 1000
  if (!Number.isSafeInteger(expiresAt)) return null
  const db = cloudflareBindings().db
  const statement =
    expectedSnapshot === null
      ? db
          .prepare(
            `INSERT INTO tournament_role_assignment
               (tournament_id, principal_id, role, granted_at, expires_at)
             SELECT ?, ?, 'check_in_operator', ?, ?
             WHERE EXISTS (
               SELECT 1
               FROM tournament_entry_owner AS owner
               JOIN team ON team.id = owner.team_id
               WHERE owner.principal_id = ?
                 AND team.tournament_id = ?
                 AND EXISTS (
                   SELECT 1 FROM participant_passkey_credential AS credential
                   WHERE credential.principal_id = owner.principal_id
                 )
             )
               AND NOT EXISTS (
                 SELECT 1 FROM tournament_role_assignment AS inherited
                 WHERE inherited.tournament_id = ?
                   AND inherited.principal_id = ?
                   AND inherited.role = 'organizer'
                   AND inherited.revoked_at IS NULL
                   AND (inherited.expires_at IS NULL OR inherited.expires_at > ?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM identity_legacy_subject_map AS migrated
                 WHERE migrated.subject_type = 'participant_principal'
                   AND migrated.subject_id = ?
               )
             ON CONFLICT (tournament_id, principal_id, role) DO NOTHING
             RETURNING principal_id, granted_at, expires_at, revoked_at`,
          )
          .bind(
            tournamentId,
            principalId,
            grantedAt,
            expiresAt,
            principalId,
            tournamentId,
            tournamentId,
            principalId,
            now,
            principalId,
          )
      : db
          .prepare(
            `UPDATE tournament_role_assignment
             SET granted_at = ?, expires_at = ?, revoked_at = NULL
             WHERE tournament_id = ?
               AND principal_id = ?
               AND role = 'check_in_operator'
               AND granted_at = ?
               AND expires_at IS ?
               AND revoked_at IS ?
               AND (
                 revoked_at IS NOT NULL
                 OR (expires_at IS NOT NULL AND expires_at <= ?)
               )
               AND EXISTS (
                 SELECT 1
                 FROM tournament_entry_owner AS owner
                 JOIN team ON team.id = owner.team_id
                 WHERE owner.principal_id = tournament_role_assignment.principal_id
                   AND team.tournament_id = tournament_role_assignment.tournament_id
                   AND EXISTS (
                     SELECT 1 FROM participant_passkey_credential AS credential
                     WHERE credential.principal_id = owner.principal_id
                   )
               )
               AND NOT EXISTS (
                 SELECT 1 FROM tournament_role_assignment AS inherited
                 WHERE inherited.tournament_id = tournament_role_assignment.tournament_id
                   AND inherited.principal_id = tournament_role_assignment.principal_id
                   AND inherited.role = 'organizer'
                   AND inherited.revoked_at IS NULL
                   AND (inherited.expires_at IS NULL OR inherited.expires_at > ?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM identity_legacy_subject_map AS migrated
                 WHERE migrated.subject_type = 'participant_principal'
                   AND migrated.subject_id = tournament_role_assignment.principal_id
               )
             RETURNING principal_id, granted_at, expires_at, revoked_at`,
          )
          .bind(
            grantedAt,
            expiresAt,
            tournamentId,
            principalId,
            expectedSnapshot.grantedAt,
            expectedSnapshot.expiresAt,
            expectedSnapshot.revokedAt,
            now,
            now,
          )
  const row = (await statement.all<AssignmentRow>()).results[0]
  return row ? assignment(row, now) : null
}

export async function revokeCheckInOperatorAssignment(
  tournamentId: number,
  principalId: string,
  expectedSnapshot: CheckInOperatorAssignmentSnapshot,
): Promise<TournamentCheckInOperatorAssignment | null> {
  await requireAdmin()
  if (
    !isValidTournamentStaffId(tournamentId) ||
    !isValidParticipantPrincipalId(principalId) ||
    !isCheckInOperatorSnapshot(expectedSnapshot)
  ) {
    return null
  }

  const now = Date.now()
  const revokedAt = Math.max(now, expectedSnapshot.grantedAt)
  const result = await cloudflareBindings()
    .db.prepare(
      `UPDATE tournament_role_assignment
       SET revoked_at = ?
       WHERE tournament_id = ?
         AND principal_id = ?
         AND role = 'check_in_operator'
         AND granted_at = ?
         AND expires_at IS ?
         AND revoked_at IS ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
         AND NOT EXISTS (
           SELECT 1 FROM identity_legacy_subject_map AS migrated
           WHERE migrated.subject_type = 'participant_principal'
             AND migrated.subject_id = tournament_role_assignment.principal_id
         )
       RETURNING principal_id, granted_at, expires_at, revoked_at`,
    )
    .bind(
      revokedAt,
      tournamentId,
      principalId,
      expectedSnapshot.grantedAt,
      expectedSnapshot.expiresAt,
      expectedSnapshot.revokedAt,
      now,
    )
    .all<AssignmentRow>()
  const row = result.results[0]
  return row ? assignment(row, now) : null
}
