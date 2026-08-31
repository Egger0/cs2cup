'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { isIsoInstant } from '@/lib/datetime'
import {
  listAdminMatches,
  listTeamsWithContact,
  replaceBracket,
  replaceMatchSchedule,
  saveAdminMatchReport,
  saveAdminMatchScore,
  ScoreCorrectionConfirmationError,
} from '@/lib/queries/admin'
import type { MatchMapInput, MatchScheduleInput } from '@/lib/queries/admin'
import { bracketSize, orderBySeed, seedPositions } from '@/lib/seeding'
import type { VetoAction } from '@/lib/types'
import { scheduleError, writeError } from './_errors'

function scoreWriteFailure(error: unknown, fallback: string) {
  if (!(error instanceof ScoreCorrectionConfirmationError)) {
    return { ok: false as const, error: writeError(error, fallback) }
  }

  const effects = [
    error.clearsCurrentReport ? '本场逐图战报' : '',
    error.affectedMatches > 0 ? `${error.affectedMatches} 场下游比赛的比分与战报` : '',
  ].filter(Boolean)
  return {
    ok: false as const,
    code: 'score_correction_confirmation' as const,
    affectedMatches: error.affectedMatches,
    clearsCurrentReport: error.clearsCurrentReport,
    confirmationToken: error.confirmationToken,
    error: `此次修正将清空${effects.join('及')}。确定继续？`,
  }
}

function scoreConfirmationToken(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null
}

export async function buildBracket(tournamentId: number) {
  await requireAdmin()

  const teams = await listTeamsWithContact(tournamentId)
  const approved = teams
    .filter(team => team.status === 'approved')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  if (approved.length < 2) return { ok: false as const, error: '通过审核的战队不足两支' }

  const size = bracketSize(approved.length)
  let orderedTeams: typeof approved
  try {
    orderedTeams = orderBySeed(approved)
  } catch {
    return { ok: false as const, error: `种子号必须唯一且位于 1–${approved.length}` }
  }

  let result: Awaited<ReturnType<typeof replaceBracket>>
  try {
    result = await replaceBracket(
      tournamentId,
      orderedTeams.map(team => team.id),
      seedPositions(size),
    )
  } catch (error) {
    return { ok: false as const, error: writeError(error, '生成对阵表失败') }
  }

  updateTag(`matches:${tournamentId}`)
  updateTag('match_map')
  updateTag('tournament')
  return result
}

export async function recordScore(
  matchId: number,
  teamAId: number,
  teamBId: number,
  scoreA: number | null,
  scoreB: number | null,
  tournamentId: number,
  confirmationToken: string | null = null,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  if (!matches.some(match => match.id === matchId)) {
    return { ok: false as const, error: '比赛不存在' }
  }

  let result: Awaited<ReturnType<typeof saveAdminMatchScore>>
  try {
    result = await saveAdminMatchScore(
      matchId,
      teamAId,
      teamBId,
      scoreA,
      scoreB,
      scoreConfirmationToken(confirmationToken),
    )
  } catch (error) {
    return scoreWriteFailure(error, '比分保存失败')
  }

  updateTag(`matches:${tournamentId}`)
  updateTag('match_map')
  updateTag('tournament')
  return result
}

export async function saveMatchReport(
  matchId: number,
  tournamentId: number,
  teamAId: number,
  teamBId: number,
  mapsJson: string,
  confirmationToken: string | null = null,
) {
  await requireAdmin()

  const matches = await listAdminMatches(tournamentId)
  if (!matches.some(match => match.id === matchId)) {
    return { ok: false as const, error: '比赛不存在' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(mapsJson)
  } catch {
    return { ok: false as const, error: '战报数据格式无效' }
  }
  if (!Array.isArray(raw) || raw.length > 32) {
    return { ok: false as const, error: '战报步骤数量无效' }
  }

  const readScore = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null
    const score = Number(value)
    return Number.isInteger(score) ? score : Number.NaN
  }

  const maps: MatchMapInput[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false as const, error: '战报步骤格式无效' }
    }
    const row = entry as Record<string, unknown>
    const mapName = String(row.mapName ?? '').trim()
    const action = String(row.action ?? '') as VetoAction
    const scoreA = readScore(row.scoreA)
    const scoreB = readScore(row.scoreB)
    if (!mapName || !['ban', 'pick', 'decider'].includes(action)) {
      return { ok: false as const, error: '请补全地图和操作类型' }
    }
    if (Number.isNaN(scoreA) || Number.isNaN(scoreB)) {
      return { ok: false as const, error: '地图比分必须是整数' }
    }
    maps.push({
      mapName,
      action,
      chosenBy: row.chosenBy === 'a' || row.chosenBy === 'b' ? row.chosenBy : null,
      scoreA,
      scoreB,
      played: row.played === true,
    })
  }

  let result: Awaited<ReturnType<typeof saveAdminMatchReport>>
  try {
    result = await saveAdminMatchReport(
      matchId,
      teamAId,
      teamBId,
      maps,
      scoreConfirmationToken(confirmationToken),
    )
  } catch (error) {
    return scoreWriteFailure(error, '战报保存失败')
  }
  if (result.ok) {
    updateTag(`matches:${tournamentId}`)
    updateTag('match_map')
    updateTag('tournament')
  }
  return result
}

export async function publishMatchSchedule(tournamentId: number, payloadJson: string) {
  await requireAdmin()

  if (!Number.isSafeInteger(tournamentId) || tournamentId <= 0) {
    return { ok: false as const, error: '赛事编号无效' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(payloadJson)
  } catch {
    return { ok: false as const, error: '赛程数据格式无效' }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false as const, error: '赛程场次数量无效' }
  }

  const normaliseTimestamp = (value: unknown): string | null | undefined => {
    if (value === null) return null
    return isIsoInstant(value) ? value : undefined
  }

  const schedule: MatchScheduleInput[] = []
  const ids = new Set<number>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false as const, error: '赛程场次格式无效' }
    }
    const row = entry as Record<string, unknown>
    const id = Number(row.id)
    const expectedScheduledAt = normaliseTimestamp(row.expectedScheduledAt)
    const scheduledAt = normaliseTimestamp(row.scheduledAt)
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      ids.has(id) ||
      expectedScheduledAt === undefined ||
      scheduledAt === undefined
    ) {
      return { ok: false as const, error: '赛程场次或时间无效' }
    }
    ids.add(id)
    schedule.push({ id, expectedScheduledAt, scheduledAt })
  }

  let result: Awaited<ReturnType<typeof replaceMatchSchedule>>
  try {
    result = await replaceMatchSchedule(tournamentId, schedule)
  } catch (error) {
    return { ok: false as const, error: scheduleError(error) }
  }

  updateTag(`matches:${tournamentId}`)
  return result
}
