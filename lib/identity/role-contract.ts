export const MANAGED_IDENTITY_ROLES = [
  'platform_owner',
  'identity_reviewer',
  'project_manager',
  'organizer',
  'referee',
  'check_in_operator',
] as const

export type ManagedIdentityRole = (typeof MANAGED_IDENTITY_ROLES)[number]

export const GRANTABLE_IDENTITY_ROLES = [
  'platform_owner',
  'identity_reviewer',
  'project_manager',
  'organizer',
  'check_in_operator',
] as const

export const PLATFORM_IDENTITY_ROLES = ['platform_owner', 'identity_reviewer'] as const
export const GAME_IDENTITY_ROLES = ['project_manager'] as const

export const isPlatformRole = (role: ManagedIdentityRole) =>
  PLATFORM_IDENTITY_ROLES.some(platform => platform === role)

export const isGameRole = (role: ManagedIdentityRole) =>
  GAME_IDENTITY_ROLES.some(game => game === role)

export interface ManagedRoleAssignment {
  readonly id: string
  readonly revision: number
  readonly accountId: string
  readonly displayName: string
  readonly username: string | null
  readonly role: ManagedIdentityRole
  readonly gameId: number | null
  readonly gameName: string | null
  readonly tournamentId: number | null
  readonly tournamentTitle: string | null
  readonly grantedAt: number
}
