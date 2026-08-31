import type { ScheduleEntry, ScheduleStatus } from '@/lib/schedule'

export type StateFilter = 'upcoming' | 'completed' | 'all'

export const STATE_LABEL: Record<StateFilter, string> = {
  upcoming: '未完赛',
  completed: '已完赛',
  all: '全部状态',
}

export const STATUS_LABEL: Record<ScheduleStatus, string> = {
  completed: '已完赛',
  upcoming: '待开赛',
  overdue: '待更新',
  waiting: '等待对阵',
  unscheduled: '待排期',
}

export function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function readState(value: string | string[] | undefined): StateFilter {
  const state = firstValue(value)
  return state === 'completed' || state === 'all' ? state : 'upcoming'
}

export function belongsToTeam(entry: ScheduleEntry, teamId: number) {
  return entry.a?.id === teamId || entry.b?.id === teamId
}

export function matchesState(entry: ScheduleEntry, state: StateFilter) {
  if (state === 'all') return true
  if (state === 'completed') return entry.status === 'completed'
  return entry.status !== 'completed'
}
