'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  grantCheckInOperatorAssignment,
  revokeCheckInOperatorAssignment,
  type CheckInOperatorAssignmentSnapshot,
} from '@/lib/queries/admin/tournament-staff'
import {
  isCheckInOperatorDuration,
  isCheckInOperatorSnapshot,
  isValidParticipantPrincipalId,
  isValidTournamentStaffId,
} from '@/lib/tournament-staff-management'

function invalidRequest(tournamentId: number, principalId: string) {
  return !isValidTournamentStaffId(tournamentId) || !isValidParticipantPrincipalId(principalId)
}

export async function grantCheckInOperator(
  tournamentId: number,
  principalId: string,
  durationHours: number,
  expectedSnapshot: CheckInOperatorAssignmentSnapshot | null,
) {
  await requireAdmin()
  if (
    invalidRequest(tournamentId, principalId) ||
    !isCheckInOperatorDuration(durationHours) ||
    (expectedSnapshot !== null && !isCheckInOperatorSnapshot(expectedSnapshot))
  ) {
    return { ok: false as const, code: 'invalid' as const, error: '授权请求无效。' }
  }

  try {
    const assignment = await grantCheckInOperatorAssignment(
      tournamentId,
      principalId,
      durationHours,
      expectedSnapshot,
    )
    if (!assignment) {
      return {
        ok: false as const,
        code: 'conflict' as const,
        error: '授权状态已变化，或该身份当前不可授权。',
      }
    }
    updateTag(`tournament-staff:${tournamentId}`)
    return { ok: true as const, assignment }
  } catch (error) {
    console.error('[staff] check-in operator grant failed', error)
    return {
      ok: false as const,
      code: 'unavailable' as const,
      error: '授权服务暂时不可用，请稍后重试。',
    }
  }
}

export async function revokeCheckInOperator(
  tournamentId: number,
  principalId: string,
  expectedSnapshot: CheckInOperatorAssignmentSnapshot,
) {
  await requireAdmin()
  if (invalidRequest(tournamentId, principalId) || !isCheckInOperatorSnapshot(expectedSnapshot)) {
    return { ok: false as const, code: 'invalid' as const, error: '撤权请求无效。' }
  }

  try {
    const assignment = await revokeCheckInOperatorAssignment(
      tournamentId,
      principalId,
      expectedSnapshot,
    )
    if (!assignment) {
      return {
        ok: false as const,
        code: 'conflict' as const,
        error: '授权状态已变化，请刷新后重试。',
      }
    }
    updateTag(`tournament-staff:${tournamentId}`)
    return { ok: true as const, assignment }
  } catch (error) {
    console.error('[staff] check-in operator revoke failed', error)
    return {
      ok: false as const,
      code: 'unavailable' as const,
      error: '撤权服务暂时不可用，请稍后重试。',
    }
  }
}
