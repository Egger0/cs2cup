import 'server-only'

import { requireAdmin } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import {
  isValidTournamentStaffId,
  maskParticipantPrincipal,
  type CheckInOperatorAssignmentSnapshot,
  type TournamentCheckInOperatorAssignment,
  type TournamentCheckInOperatorCandidate,
  type TournamentCheckInOperatorManager,
  type TournamentCheckInOperatorTeam,
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

function assignment(
  row: AssignmentRow,
  now: number,
  candidate?: TournamentCheckInOperatorCandidate,
): TournamentCheckInOperatorAssignment {
  const snapshot: CheckInOperatorAssignmentSnapshot = {
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
  return {
    principalId: row.principal_id,
    reference: maskParticipantPrincipal(row.principal_id),
    ...snapshot,
    active:
      snapshot.revokedAt === null && (snapshot.expiresAt === null || snapshot.expiresAt > now),
    team: candidate?.team ?? null,
    snapshot,
  }
}

async function candidateRows(tournamentId: number, now: number) {
  return (
    await cloudflareBindings()
      .db.prepare(
        `SELECT owner.principal_id, team.id AS team_id, team.tag AS team_tag,
                team.name AS team_name, team.captain,
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
           AND NOT EXISTS (
             SELECT 1 FROM identity_legacy_subject_map AS migrated
             WHERE migrated.subject_type = 'participant_principal'
               AND migrated.subject_id = owner.principal_id
           )
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
         WHERE tournament_id = ? AND role = 'check_in_operator'
           AND NOT EXISTS (
             SELECT 1 FROM identity_legacy_subject_map AS migrated
             WHERE migrated.subject_type = 'participant_principal'
               AND migrated.subject_id = tournament_role_assignment.principal_id
           )
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
