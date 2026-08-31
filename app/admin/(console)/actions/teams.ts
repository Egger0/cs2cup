'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { assignTeamSeed, removeTeam, setTeamStatus } from '@/lib/queries/admin'
import type { TeamStatus } from '@/lib/types'
import { writeError } from './_errors'

export async function updateTeamStatus(id: number, status: TeamStatus, tournamentId: number) {
  await requireAdmin()
  await setTeamStatus(id, status)
  updateTag(`teams:${tournamentId}`)
}

export async function updateTeamSeed(id: number, seed: number | null, tournamentId: number) {
  await requireAdmin()

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

export async function deleteTeam(id: number, tournamentId: number) {
  await requireAdmin()
  await removeTeam(id)
  updateTag(`teams:${tournamentId}`)
}
