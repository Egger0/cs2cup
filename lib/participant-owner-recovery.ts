export type OwnedEntryRecoveryAction =
  | 'login-and-confirm'
  | 'switch-participant'
  | 'contact-organizer'

export function ownedEntryRecoveryAction(
  hasActiveParticipant: boolean,
  conflict: boolean,
): OwnedEntryRecoveryAction {
  if (hasActiveParticipant) return 'switch-participant'
  return conflict ? 'contact-organizer' : 'login-and-confirm'
}
