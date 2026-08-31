import { dateTimeLocalToIso, isoToDateTimeLocal } from '@/lib/datetime'
import type { Match } from '@/lib/types'

export type ScheduleDraft = Record<number, string>

export const MAX_ROUND_GAP_DAYS = 365
export const MAX_MATCH_GAP_MINUTES = 1_440

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

export function initialScheduleDraft(matches: readonly Match[]): ScheduleDraft {
  return Object.fromEntries(
    matches.map(match => [match.id, isoToDateTimeLocal(match.scheduledAt ?? '') ?? '']),
  )
}

export function emptyScheduleDraft(matches: readonly Match[]): ScheduleDraft {
  return Object.fromEntries(matches.map(match => [match.id, '']))
}

export function isScheduleDraftDirty(
  matches: readonly Match[],
  draft: ScheduleDraft,
  original: ScheduleDraft,
) {
  return matches.some(match => (draft[match.id] ?? '') !== original[match.id])
}

export function generateSchedulePreview(
  matches: readonly Match[],
  values: { start: string; roundGap: string; matchGap: string },
) {
  const start = dateTimeLocalToIso(values.start)
  const roundGapDays = Number(values.roundGap)
  const matchGapMinutes = Number(values.matchGap)

  if (!start) return { ok: false as const, error: '请填写有效的北京时间' }
  if (
    !Number.isSafeInteger(roundGapDays) ||
    roundGapDays < 0 ||
    roundGapDays > MAX_ROUND_GAP_DAYS
  ) {
    return {
      ok: false as const,
      error: `每轮间隔必须是 0–${MAX_ROUND_GAP_DAYS} 天的整数`,
    }
  }
  if (
    !Number.isSafeInteger(matchGapMinutes) ||
    matchGapMinutes < 0 ||
    matchGapMinutes > MAX_MATCH_GAP_MINUTES
  ) {
    return {
      ok: false as const,
      error: `场次间隔必须是 0–${MAX_MATCH_GAP_MINUTES} 分钟的整数`,
    }
  }

  const startTime = Date.parse(start)
  const roundSlots = new Map<number, number>()
  const draft: ScheduleDraft = {}
  for (const match of matches) {
    const roundSlot = roundSlots.get(match.round) ?? 0
    const timestamp =
      startTime + match.round * roundGapDays * DAY_MS + roundSlot * matchGapMinutes * MINUTE_MS
    draft[match.id] = isoToDateTimeLocal(timestamp) ?? ''
    roundSlots.set(match.round, roundSlot + 1)
  }

  return { ok: true as const, draft }
}

export function buildSchedulePayload(
  matches: readonly Match[],
  draft: ScheduleDraft,
  original: ScheduleDraft,
) {
  const desired = new Map<number, string | null>()
  for (const match of matches) {
    const local = (draft[match.id] ?? '').trim()
    const scheduledAt =
      local === original[match.id] ? match.scheduledAt : local ? dateTimeLocalToIso(local) : null
    if (local && !scheduledAt) return { ok: false as const, error: '赛程中存在无效时间' }
    desired.set(match.id, scheduledAt)
  }

  for (const match of matches) {
    const childTime = desired.get(match.id)
    if (!childTime) continue
    for (const sourceId of [match.sourceMatchAId, match.sourceMatchBId]) {
      if (sourceId === null) continue
      const sourceTime = desired.get(sourceId)
      if (sourceTime && Date.parse(childTime) <= Date.parse(sourceTime)) {
        return {
          ok: false as const,
          error: `${match.roundLabel} #${match.slot + 1} 必须晚于来源比赛`,
        }
      }
    }
  }

  return {
    ok: true as const,
    rows: matches.map(match => ({
      id: match.id,
      expectedScheduledAt: match.scheduledAt,
      scheduledAt: desired.get(match.id) ?? null,
    })),
  }
}

export function hasPublishedScheduleOverwrite(
  matches: readonly Match[],
  draft: ScheduleDraft,
  original: ScheduleDraft,
) {
  return matches.some(
    match => match.scheduledAt !== null && (draft[match.id] ?? '') !== original[match.id],
  )
}
