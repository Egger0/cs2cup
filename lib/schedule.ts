import {
  indexMatches,
  indexTeams,
  isByeMatch,
  isCompletedMatch,
  resolveMatch,
  type ResolvedMatch,
} from './bracket'
import { formatSiteDate, formatSiteTime, siteDayKey } from './datetime'
import type { Match, PublicTeam } from './types'

export type ScheduleStatus = 'completed' | 'upcoming' | 'overdue' | 'waiting' | 'unscheduled'

export interface ScheduleEntry extends ResolvedMatch {
  status: ScheduleStatus
  scheduledTime: number | null
  dayKey: string | null
  dateLabel: string | null
  timeLabel: string | null
}

export interface ScheduleDayGroup {
  key: string
  dayKey: string | null
  label: string
  entries: ScheduleEntry[]
}

type NowValue = number | Date

function nowTimestamp(now: NowValue) {
  const timestamp = now instanceof Date ? now.getTime() : now
  if (!Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new RangeError('now must be a valid timestamp or Date')
  }
  return timestamp
}

function bracketOrder(a: ScheduleEntry, b: ScheduleEntry) {
  return a.match.round - b.match.round || a.match.slot - b.match.slot || a.match.id - b.match.id
}

function compareEntries(a: ScheduleEntry, b: ScheduleEntry) {
  if (a.scheduledTime === null && b.scheduledTime === null) return bracketOrder(a, b)
  if (a.scheduledTime === null) return 1
  if (b.scheduledTime === null) return -1
  return a.scheduledTime - b.scheduledTime || bracketOrder(a, b)
}

function classifyEntry(
  match: Match,
  a: PublicTeam | null,
  b: PublicTeam | null,
  scheduledTime: number | null,
  now: number,
): ScheduleStatus {
  if (isCompletedMatch(match)) return 'completed'
  if (scheduledTime === null) return 'unscheduled'
  if (!a || !b) return 'waiting'
  return scheduledTime > now ? 'upcoming' : 'overdue'
}

export function buildScheduleEntries(
  matches: readonly Match[],
  teams: readonly PublicTeam[],
  now: NowValue = Date.now(),
): ScheduleEntry[] {
  const timestamp = nowTimestamp(now)
  const matchList = [...matches]
  const matchIndex = indexMatches(matchList)
  const teamIndex = indexTeams([...teams])

  return matchList
    .filter(match => !isByeMatch(match))
    .map(match => {
      const resolved = resolveMatch(match, matchIndex, teamIndex)
      const dayKey = match.scheduledAt ? siteDayKey(match.scheduledAt) : null
      const scheduledTime = dayKey && match.scheduledAt
        ? new Date(match.scheduledAt).getTime()
        : null

      return {
        ...resolved,
        status: classifyEntry(match, resolved.a, resolved.b, scheduledTime, timestamp),
        scheduledTime,
        dayKey,
        dateLabel: match.scheduledAt && dayKey ? formatSiteDate(match.scheduledAt) : null,
        timeLabel: match.scheduledAt && dayKey ? formatSiteTime(match.scheduledAt) : null,
      }
    })
    .sort(compareEntries)
}

export function groupScheduleEntries(entries: readonly ScheduleEntry[]): ScheduleDayGroup[] {
  const groups = new Map<string, ScheduleDayGroup>()

  for (const entry of [...entries].sort(compareEntries)) {
    const key = entry.dayKey ?? 'unscheduled'
    const existing = groups.get(key)
    if (existing) {
      existing.entries.push(entry)
      continue
    }

    groups.set(key, {
      key,
      dayKey: entry.dayKey,
      label: entry.dateLabel ?? '时间待定',
      entries: [entry],
    })
  }

  return [...groups.values()]
}

export function selectNextScheduleEntry(
  entries: readonly ScheduleEntry[],
  now: NowValue = Date.now(),
): ScheduleEntry | null {
  const timestamp = nowTimestamp(now)
  const incomplete = entries.filter(entry => !isCompletedMatch(entry.match))

  const future = incomplete
    .filter(entry => entry.scheduledTime !== null && entry.scheduledTime >= timestamp)
    .sort(compareEntries)
  if (future[0]) return future[0]

  const overdue = incomplete
    .filter(entry => entry.scheduledTime !== null && entry.scheduledTime < timestamp)
    .sort((a, b) => {
      const readyA = a.a && a.b ? 1 : 0
      const readyB = b.a && b.b ? 1 : 0
      return readyB - readyA || b.scheduledTime! - a.scheduledTime! || bracketOrder(a, b)
    })
  if (overdue[0]) return overdue[0]

  const unscheduled = incomplete
    .filter(entry => entry.scheduledTime === null)
    .sort((a, b) => {
      const readyA = a.a && a.b ? 1 : 0
      const readyB = b.a && b.b ? 1 : 0
      return readyB - readyA || bracketOrder(a, b)
    })
  return unscheduled[0] ?? null
}
