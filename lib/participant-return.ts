const TOURNAMENT_SLUG = '[a-z0-9][a-z0-9-]{0,99}'
const OPAQUE_TOKEN = '[A-Za-z0-9_-]{43}'

const PARTICIPANT_REGISTRATION_PATH = new RegExp(
  `^/tournaments/${TOURNAMENT_SLUG}/registration/${OPAQUE_TOKEN}(?![\\s\\S])`,
)

export const DEFAULT_PARTICIPANT_RETURN_PATH = '/me'

export function isParticipantReturnPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (value === DEFAULT_PARTICIPANT_RETURN_PATH || PARTICIPANT_REGISTRATION_PATH.test(value))
  )
}

export function safeParticipantReturnPath(value: unknown): string {
  return isParticipantReturnPath(value) ? value : DEFAULT_PARTICIPANT_RETURN_PATH
}

export function participantRegistrationReturnPath(slug: string, token: string): string | null {
  const path = `/tournaments/${slug}/registration/${token}`
  return PARTICIPANT_REGISTRATION_PATH.test(path) ? path : null
}
