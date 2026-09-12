export const MANAGED_IDENTITY_ROLES = [
  'platform_owner',
  'identity_reviewer',
  'organizer',
  'referee',
  'check_in_operator',
] as const

export type ManagedIdentityRole = (typeof MANAGED_IDENTITY_ROLES)[number]

export const GRANTABLE_IDENTITY_ROLES = [
  'platform_owner',
  'identity_reviewer',
  'organizer',
  'check_in_operator',
] as const

export const PLATFORM_IDENTITY_ROLES = ['platform_owner', 'identity_reviewer'] as const

export const isPlatformRole = (role: ManagedIdentityRole) =>
  PLATFORM_IDENTITY_ROLES.some(platform => platform === role)

export interface ManagedRoleAssignment {
  readonly id: string
  readonly revision: number
  readonly accountId: string
  readonly displayName: string
  readonly username: string | null
  readonly role: ManagedIdentityRole
  readonly tournamentId: number | null
  readonly tournamentTitle: string | null
  readonly grantedAt: number
}
