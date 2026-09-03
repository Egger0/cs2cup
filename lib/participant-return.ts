const TOURNAMENT_SLUG = '[a-z0-9][a-z0-9-]{0,99}'
const OPAQUE_TOKEN = '[A-Za-z0-9_-]{43}'
const PARTICIPANT_ENTRY_ID = /^[1-9][0-9]{0,15}$/
const TOURNAMENT_CHECK_IN_PATH = /^\/admin\/tournaments\/([1-9][0-9]{0,15})\/check-in$/

const PARTICIPANT_REGISTRATION_PATH = new RegExp(
  `^/tournaments/${TOURNAMENT_SLUG}/registration/${OPAQUE_TOKEN}(?![\\s\\S])`,
)

export const DEFAULT_PARTICIPANT_RETURN_PATH = '/me'

export function participantEntryAddedId(value: unknown): number | null {
  if (typeof value !== 'string' || !PARTICIPANT_ENTRY_ID.test(value)) return null
  const teamId = Number(value)
  return Number.isSafeInteger(teamId) ? teamId : null
}

export function participantEntryAddedPath(teamId: number): string | null {
  return Number.isSafeInteger(teamId) && teamId > 0
    ? `${DEFAULT_PARTICIPANT_RETURN_PATH}?joined=${teamId}`
    : null
}

export function participantStaffCheckInPath(tournamentId: number): string | null {
  return Number.isSafeInteger(tournamentId) && tournamentId > 0
    ? `/admin/tournaments/${tournamentId}/check-in`
    : null
}

function isTournamentCheckInPath(value: string) {
  const match = TOURNAMENT_CHECK_IN_PATH.exec(value)
  return Boolean(match && Number.isSafeInteger(Number(match[1])))
}

export function isParticipantStaffReturnPath(value: unknown): value is string {
  return typeof value === 'string' && isTournamentCheckInPath(value)
}

export function isParticipantReturnPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEFAULT_PARTICIPANT_RETURN_PATH ||
      PARTICIPANT_REGISTRATION_PATH.test(value) ||
      isParticipantStaffReturnPath(value))
  )
}

export function safeParticipantReturnPath(value: unknown): string {
  return isParticipantReturnPath(value) ? value : DEFAULT_PARTICIPANT_RETURN_PATH
}

export function participantRegistrationReturnPath(slug: string, token: string): string | null {
  const path = `/tournaments/${slug}/registration/${token}`
  return PARTICIPANT_REGISTRATION_PATH.test(path) ? path : null
}
