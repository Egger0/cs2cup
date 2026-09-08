'use server'

import { updateTag } from 'next/cache'
import {
  getCurrentTournamentStaffAccess,
  requireAdmin,
  TournamentStaffAccessError,
} from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { isIsoInstant } from '@/lib/datetime'
import { getAuthContext } from '@/lib/identity/kernel'
import { claimRosterSeat } from '@/lib/identity/roster-claim'
import { assignTeamSeed, removeTeam, setTeamCheckedIn, setTeamStatus } from '@/lib/queries/admin'
import type { TeamStatus } from '@/lib/types'
import { writeError } from './_errors'

const TEAM_STATUSES: readonly TeamStatus[] = ['pending', 'approved', 'rejected']

function validId(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export async function updateTeamStatus(id: number, status: TeamStatus, tournamentId: number) {
  await requireAdmin()
  if (!validId(id) || !validId(tournamentId)) {
    return { ok: false as const, error: '战队或赛事编号无效' }
  }
  if (!TEAM_STATUSES.includes(status)) {
    return { ok: false as const, error: '战队状态无效' }
  }

  try {
    const rows = await setTeamStatus(id, tournamentId, status)
    if (!rows.length) return { ok: false as const, error: '战队不存在或不属于该赛事' }
  } catch (error) {
    return { ok: false as const, error: writeError(error, '战队状态保存失败') }
  }
  updateTag(`teams:${tournamentId}`)
  return { ok: true as const }
}

export async function updateTeamSeed(id: number, seed: number | null, tournamentId: number) {
  await requireAdmin()

  if (!validId(id) || !validId(tournamentId)) {
    return { ok: false as const, error: '战队或赛事编号无效' }
  }

  if (seed !== null && !Number.isInteger(seed)) {
    return { ok: false as const, error: '种子号必须是整数' }
  }

  try {
    await assignTeamSeed(tournamentId, id, seed)
  } catch (error) {
    return { ok: false as const, error: writeError(error, '种子号保存失败') }
  }

  updateTag(`teams:${tournamentId}`)
  return { ok: true as const }
}

export async function updateTeamCheckIn(
  id: number,
  checkedIn: boolean,
  expectedCheckedInAt: string | null,
  tournamentId: number,
) {
  if (!validId(id) || !validId(tournamentId)) {
    return { ok: false as const, code: 'invalid' as const, error: '战队或赛事编号无效' }
  }
  if (typeof checkedIn !== 'boolean') {
    return { ok: false as const, code: 'invalid' as const, error: '签到状态无效' }
  }
  if (
    (expectedCheckedInAt !== null && !isIsoInstant(expectedCheckedInAt)) ||
    checkedIn === (expectedCheckedInAt !== null)
  ) {
    return { ok: false as const, code: 'invalid' as const, error: '签到状态无效' }
  }

  let checkedInAt: string | null
  try {
    const access = await getCurrentTournamentStaffAccess(tournamentId, 'tournament.check_in.write')
    if (!access.ok) {
      return {
        ok: false as const,
        code: 'forbidden' as const,
        error: '签到权限已失效，请重新进入签到台。',
      }
    }
    const rows = await setTeamCheckedIn(id, tournamentId, checkedIn, expectedCheckedInAt)
    if (!rows.length) {
      return {
        ok: false as const,
        code: 'conflict' as const,
        error: '签到状态已变化，正在同步最新记录。',
      }
    }
    checkedInAt = rows[0]?.checked_in_at ?? null
  } catch (error) {
    if (error instanceof TournamentStaffAccessError) {
      return {
        ok: false as const,
        code: 'forbidden' as const,
        error: '签到权限已失效，请重新进入签到台。',
      }
    }
    return {
      ok: false as const,
      code: 'unavailable' as const,
      error: writeError(error, '签到状态保存失败'),
    }
  }
  updateTag(`teams:${tournamentId}`)
  return { ok: true as const, checkedInAt }
}

export async function deleteTeam(id: number, tournamentId: number) {
  await requireAdmin()
  if (!validId(id) || !validId(tournamentId)) {
    return { ok: false as const, error: '战队或赛事编号无效' }
  }

  try {
    const rows = await removeTeam(id, tournamentId)
    if (!rows.length) return { ok: false as const, error: '战队不存在或不属于该赛事' }
  } catch (error) {
    return { ok: false as const, error: writeError(error, '战队删除失败') }
  }
  updateTag(`teams:${tournamentId}`)
  return { ok: true as const }
}

export async function confirmRosterSeat(
  tournamentId: number,
  playerId: number,
  username: string,
): Promise<{ ok: boolean; holder?: string; error?: string }> {
  try {
    await getCurrentTournamentStaffAccess(tournamentId, 'tournament.check_in.write')
  } catch (error) {
    if (error instanceof TournamentStaffAccessError) {
      return { ok: false, error: '没有本赛事的签到权限。' }
    }
    throw error
  }
  const context = await getAuthContext()
  if (context.kind !== 'authenticated') return { ok: false, error: '请重新登录后再试。' }

  const database = cloudflareBindings().db
  const target = await database
    .prepare(
      `SELECT account.id AS id, account.display_name AS display_name
       FROM identity_account AS account
       JOIN identity_password_credential AS credential ON credential.account_id = account.id
       WHERE credential.username = ? AND account.status = 'active'`,
    )
    .bind(username.trim())
    .first<{ id: string; display_name: string }>()
  if (!target) return { ok: false, error: '找不到这个用户名对应的账号。' }

  const claim = await claimRosterSeat(database, {
    playerId,
    accountId: target.id,
    authorisedByAccountId: context.account.id,
    reason: 'Verified in person at check-in',
    now: Date.now(),
  })
  if (!claim.ok) {
    return {
      ok: false,
      error: {
        not_authorised: '没有确认这个席位的权限。',
        seat_taken: '这个席位已经由其他账号认领。',
        seat_missing: '找不到这个席位。',
        self_authorised: '不能把席位确认给自己。',
      }[claim.reason],
    }
  }
  updateTag(`check-in-${tournamentId}`)
  return { ok: true, holder: target.display_name }
}
