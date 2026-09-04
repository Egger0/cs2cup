import type { RegistrationDraftValues } from '../../registration-form.ts'
import type { TeamStatus } from '../../types.ts'

export type RegistrationWorkflowErrorCode =
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'reauth_required'
  | 'locked'
  | 'conflict'
  | 'account_not_found'
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

export interface RegistrationDraft {
  tournament: { id: number; slug: string; title: string }
  values: RegistrationDraftValues
  updatedAt: number
  revision: number
}

export interface RegistrationInvitation {
  id: string
  teamId: number
  teamName: string
  teamTag: string
  tournamentSlug: string
  tournamentTitle: string
  relationship: 'owner' | 'manager'
  accountId: string
  accountName: string
  username: string | null
  inviterName: string
  expiresAt: number
}

export interface RegistrationCollaborator {
  membershipId: string
  accountId: string
  displayName: string
  username: string | null
  grantedAt: number
}

export interface InvitationRow {
  id: string
  team_id: number
  team_name: string
  team_tag: string
  tournament_slug: string
  tournament_title: string
  relationship: 'owner' | 'manager'
  invited_account_id: string
  inviter_account_id: string
  invited_name: string
  invited_username: string | null
  inviter_name: string
  expires_at: number
  revision: number
}
