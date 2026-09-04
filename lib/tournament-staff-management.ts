export const CHECK_IN_OPERATOR_DURATIONS = [8, 24, 168] as const

export type CheckInOperatorDurationHours = (typeof CHECK_IN_OPERATOR_DURATIONS)[number]

export interface CheckInOperatorAssignmentSnapshot {
  grantedAt: number
  expiresAt: number | null
  revokedAt: number | null
}

export interface TournamentCheckInOperatorTeam {
  id: number
  tag: string
  name: string
  captain: string
}

export interface TournamentCheckInOperatorCandidate {
  principalId: string
  reference: string
  team: TournamentCheckInOperatorTeam
}

export interface CheckInOperatorAssignment extends CheckInOperatorAssignmentSnapshot {
  principalId: string
  reference: string
  active: boolean
  team: TournamentCheckInOperatorTeam | null
  snapshot: CheckInOperatorAssignmentSnapshot
}

export type TournamentCheckInOperatorAssignment = CheckInOperatorAssignment

export interface TournamentCheckInOperatorManager {
  tournament: {
    id: number
    title: string
    season: string
    edition: number
  }
  candidates: TournamentCheckInOperatorCandidate[]
  assignments: CheckInOperatorAssignment[]
}

const PRINCIPAL_ID = /^p_[A-Za-z0-9_-]{43}$/

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

export function isValidTournamentStaffId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

export function isValidParticipantPrincipalId(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_ID.test(value)
}

export function isCheckInOperatorDuration(value: unknown): value is CheckInOperatorDurationHours {
  return CHECK_IN_OPERATOR_DURATIONS.some(duration => duration === value)
}

export function isCheckInOperatorSnapshot(
  value: unknown,
): value is CheckInOperatorAssignmentSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<CheckInOperatorAssignmentSnapshot>
  return (
    validTimestamp(snapshot.grantedAt) &&
    (snapshot.expiresAt === null ||
      (validTimestamp(snapshot.expiresAt) && snapshot.expiresAt > snapshot.grantedAt)) &&
    (snapshot.revokedAt === null ||
      (validTimestamp(snapshot.revokedAt) && snapshot.revokedAt >= snapshot.grantedAt))
  )
}

export function maskParticipantPrincipal(principalId: string) {
  return `LEGACY · …${principalId.slice(-8)}`
}
