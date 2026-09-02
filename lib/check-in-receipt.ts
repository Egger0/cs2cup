import { d1UtcTimestampToIso, formatSiteDateTime, isIsoInstant } from './datetime.ts'
import type { TeamStatus } from './types.ts'

export type ParticipantCheckInState =
  | 'checked-in'
  | 'not-recorded'
  | 'waiting-review'
  | 'not-applicable'
  | 'unavailable'

export interface ParticipantCheckInReceipt {
  state: ParticipantCheckInState
  label: string
  instant: string | null
  timeLabel: string | null
}

export function participantCheckInReceipt(
  status: TeamStatus,
  checkedInAt: string | null,
  now = Date.now(),
): ParticipantCheckInReceipt {
  if (status === 'pending') {
    return { state: 'waiting-review', label: '审核通过后开放', instant: null, timeLabel: null }
  }
  if (status === 'rejected') {
    return {
      state: 'not-applicable',
      label: '报名未通过，无法签到',
      instant: null,
      timeLabel: null,
    }
  }
  if (checkedInAt === null) {
    return { state: 'not-recorded', label: '未签到', instant: null, timeLabel: null }
  }

  const instant =
    d1UtcTimestampToIso(checkedInAt) ?? (isIsoInstant(checkedInAt) ? checkedInAt : null)
  const timestamp = instant ? Date.parse(instant) : Number.NaN
  if (!instant || !Number.isFinite(now) || !Number.isFinite(timestamp) || timestamp > now) {
    return { state: 'unavailable', label: '状态待确认', instant: null, timeLabel: null }
  }

  return {
    state: 'checked-in',
    label: '已签到',
    instant,
    timeLabel: formatSiteDateTime(instant),
  }
}
