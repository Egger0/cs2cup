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
  type TournamentCheckInOperatorManager,
  type TournamentCheckInOperatorTeam,
} from '../../tournament-staff-management'

export {
  CHECK_IN_OPERATOR_DURATIONS,
  type CheckInOperatorAssignment,
  type CheckInOperatorAssignmentSnapshot,
  type TournamentCheckInOperatorManager,
} from '../../tournament-staff-management'

interface CandidateRow {
  principal_id: string
  team_id: number
  team_tag: string
  team_name: string
  captain: string
  can_grant: number
}

interface AssignmentRow {
  principal_id: string
  granted_at: number
  expires_at: number | null
  revoked_at: number | null
}

function team(row: CandidateRow): TournamentCheckInOperatorTeam {
  return {
    id: row.team_id,
    tag: row.team_tag,
    name: row.team_name,
    captain: row.captain,
  }
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

async function candidateRows(tournamentId: number, now: number) {
  return (
    await cloudflareBindings()
      .db.prepare(
        `SELECT
           owner.principal_id,
           team.id AS team_id,
           team.tag AS team_tag,
           team.name AS team_name,
           team.captain,
           CASE WHEN EXISTS (
             SELECT 1 FROM participant_passkey_credential AS credential
             WHERE credential.principal_id = owner.principal_id
           ) AND NOT EXISTS (
             SELECT 1 FROM tournament_role_assignment AS inherited
             WHERE inherited.tournament_id = team.tournament_id
               AND inherited.principal_id = owner.principal_id
               AND inherited.role = 'organizer' AND inherited.revoked_at IS NULL
               AND (inherited.expires_at IS NULL OR inherited.expires_at > ?)
           ) THEN 1 ELSE 0 END AS can_grant
         FROM tournament_entry_owner AS owner
         JOIN team ON team.id = owner.team_id
         WHERE team.tournament_id = ?
         ORDER BY team.created_at DESC, team.id DESC`,
      )
      .bind(now, tournamentId)
      .all<CandidateRow>()
  ).results
}

function mapCandidates(rows: CandidateRow[]) {
  const candidates = new Map<string, TournamentCheckInOperatorCandidate>()
  for (const row of rows) {
    if (row.can_grant !== 1 || candidates.has(row.principal_id)) continue
    candidates.set(row.principal_id, {
      principalId: row.principal_id,
      reference: maskParticipantPrincipal(row.principal_id),
      team: team(row),
    })
  }
  return [...candidates.values()]
}

export async function getTournamentCheckInOperatorManager(
  tournamentId: number,
): Promise<TournamentCheckInOperatorManager | null> {
  await requireAdmin()
  if (!isValidTournamentStaffId(tournamentId)) return null

  const now = Date.now()
  const db = cloudflareBindings().db
  const [tournament, rows, assignmentResult] = await Promise.all([
    db
      .prepare('SELECT id, title, season, edition FROM tournament WHERE id = ?')
      .bind(tournamentId)
      .first<TournamentCheckInOperatorManager['tournament']>(),
    candidateRows(tournamentId, now),
    db
      .prepare(
        `SELECT principal_id, granted_at, expires_at, revoked_at
         FROM tournament_role_assignment
         WHERE tournament_id = ?
           AND role = 'check_in_operator'
         ORDER BY granted_at DESC, principal_id ASC`,
      )
      .bind(tournamentId)
      .all<AssignmentRow>(),
  ])
  if (!tournament) return null

  const candidates = mapCandidates(rows)
  const byPrincipal = new Map<string, TournamentCheckInOperatorCandidate>()
  for (const row of rows) {
    if (byPrincipal.has(row.principal_id)) continue
    byPrincipal.set(row.principal_id, {
      principalId: row.principal_id,
      reference: maskParticipantPrincipal(row.principal_id),
      team: team(row),
    })
  }
  return {
    tournament,
    candidates,
    assignments: assignmentResult.results.map(row =>
      assignment(row, now, byPrincipal.get(row.principal_id)),
    ),
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
