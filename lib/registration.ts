import { d1UtcTimestampToIso, isIsoInstant } from './datetime'

export type RegistrationAvailabilityReason =
  | 'status_closed'
  | 'deadline_passed'
  | 'capacity_reached'
  | 'invalid_configuration'

export interface RegistrationAvailability {
  open: boolean
  seatsLeft: number
  reason: RegistrationAvailabilityReason | null
}

interface RegistrationWindow {
  status: string
  regDeadline: string | null
  teamCap: number
}

export interface RegistrationRosterPlayer {
  nickname: string
  substitute: boolean
}

export type RegistrationRosterResult =
  | { ok: true; players: RegistrationRosterPlayer[] }
  | {
      ok: false
      code: 'STARTER_COUNT' | 'SUBSTITUTE_COUNT' | 'DUPLICATE_NICKNAME'
      error: string
    }

function deadlineTimestamp(value: string) {
  const instant = isIsoInstant(value) ? value : d1UtcTimestampToIso(value)
  return instant ? Date.parse(instant) : null
}

export function registrationAvailability(
  tournament: RegistrationWindow,
  taken: number,
  now = Date.now(),
): RegistrationAvailability {
  const validCounts =
    Number.isSafeInteger(tournament.teamCap) &&
    tournament.teamCap > 0 &&
    Number.isSafeInteger(taken) &&
    taken >= 0
  const seatsLeft = validCounts ? Math.max(0, tournament.teamCap - taken) : 0

  if (!validCounts || !Number.isFinite(now)) {
    return { open: false, seatsLeft, reason: 'invalid_configuration' }
  }
  if (!['registration', 'postponed'].includes(tournament.status)) {
    return { open: false, seatsLeft, reason: 'status_closed' }
  }
  if (tournament.regDeadline !== null) {
    const deadline = deadlineTimestamp(tournament.regDeadline)
    if (deadline === null) {
      return { open: false, seatsLeft, reason: 'invalid_configuration' }
    }
    if (deadline <= now) return { open: false, seatsLeft, reason: 'deadline_passed' }
  }
  if (seatsLeft === 0) return { open: false, seatsLeft, reason: 'capacity_reached' }
  return { open: true, seatsLeft, reason: null }
}

export function validateRegistrationRoster(
  input: readonly RegistrationRosterPlayer[],
): RegistrationRosterResult {
  const players = input
    .map(player => ({ ...player, nickname: player.nickname.trim() }))
    .filter(player => player.nickname)
  const starters = players.filter(player => !player.substitute)
  const substitutes = players.filter(player => player.substitute)

  if (starters.length !== 5) {
    return { ok: false, code: 'STARTER_COUNT', error: '请填写正好 5 名首发队员' }
  }
  if (substitutes.length > 1) {
    return { ok: false, code: 'SUBSTITUTE_COUNT', error: '最多只能填写 1 名替补队员' }
  }

  const nicknames = new Set<string>()
  for (const player of players) {
    const nickname = player.nickname.normalize('NFKC').toLocaleLowerCase('zh-CN')
    if (nicknames.has(nickname)) {
      return { ok: false, code: 'DUPLICATE_NICKNAME', error: '队员昵称不能重复' }
    }
    nicknames.add(nickname)
  }

  return { ok: true, players }
}
