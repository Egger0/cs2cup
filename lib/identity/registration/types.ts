import type { TeamStatus } from '../../types.ts'

export type RegistrationWorkflowErrorCode =
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'reauth_required'
  | 'locked'
  | 'conflict'
  | 'already_has_access'

export class RegistrationWorkflowError extends Error {
  readonly code: RegistrationWorkflowErrorCode

  constructor(code: RegistrationWorkflowErrorCode) {
    super(code)
    this.name = 'RegistrationWorkflowError'
    this.code = code
  }
}

export interface AccountTournamentRegistration {
  relationship: 'owner' | 'manager'
  tournament: { id: number; slug: string; title: string }
  team: {
    id: number
    name: string
    tag: string
    captain: string
    contact: string
    dept: string | null
    note: string | null
    status: TeamStatus
    checkedInAt: string | null
    registeredAt: string
    members: Array<{
      id: number
      nickname: string
      role: string | null
      isSubstitute: boolean
      sortOrder: number
    }>
  }
}
