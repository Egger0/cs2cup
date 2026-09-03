import 'server-only'

export const IDENTITY_CAPABILITIES = [
  'platform.configure',
  'platform.access.manage',
  'platform.audit.view',
  'platform.identity.review',
  'tournament.view',
  'tournament.configure',
  'tournament.entries.review',
  'tournament.entries.export',
  'tournament.check_in.read',
  'tournament.check_in.write',
  'tournament.bracket.manage',
  'tournament.schedule.manage',
  'tournament.results.write',
  'tournament.media.manage',
  'tournament.access.manage',
  'tournament.audit.view',
  'registration.view',
  'registration.edit',
  'registration.invite',
  'registration.transfer',
  'registration.delete',
] as const

export type IdentityCapability = (typeof IDENTITY_CAPABILITIES)[number]
export type IdentityRole =
  | 'platform_owner'
  | 'identity_reviewer'
  | 'organizer'
  | 'referee'
  | 'check_in_operator'
export type RegistrationRelationship = 'owner' | 'manager'
export type AssuranceRequirement =
  | 'base'
  | 'recent'
  | 'phishing_resistant'
  | 'recent_phishing_resistant'

export interface EffectiveAssurancePolicy {
  label: AssuranceRequirement
  authenticatedMaxAgeMs: number | null
  phishingResistantMaxAgeMs: number | null
}

export type AuthorizationResource =
  | { kind: 'platform' }
  | { kind: 'tournament'; tournamentId: number }
  | { kind: 'registration'; registrationId: number }

export type ResolvedAuthorizationResource =
  | { kind: 'platform' }
  | { kind: 'tournament'; tournamentId: number }
  | { kind: 'registration'; registrationId: number; tournamentId: number }

export type AuthorizationDecision =
  | {
      ok: true
      accountId: string
      capability: IdentityCapability
      resource: ResolvedAuthorizationResource
      assurance: AssuranceRequirement
    }
  | {
      ok: false
      reason:
        | 'anonymous'
        | 'invalid_request'
        | 'session_invalid'
        | 'recovery_restricted'
        | 'assurance_required'
        | 'forbidden'
    }

const TOURNAMENT_CAPABILITIES = IDENTITY_CAPABILITIES.filter(capability =>
  capability.startsWith('tournament.'),
)

const ROLE_CAPABILITIES: Record<IdentityRole, readonly IdentityCapability[]> = {
  platform_owner: IDENTITY_CAPABILITIES.filter(
    capability => capability.startsWith('platform.') || capability.startsWith('tournament.'),
  ),
  identity_reviewer: ['platform.identity.review'],
  organizer: TOURNAMENT_CAPABILITIES,
  referee: ['tournament.view', 'tournament.results.write'],
  check_in_operator: ['tournament.view', 'tournament.check_in.read', 'tournament.check_in.write'],
}

const RELATIONSHIP_CAPABILITIES: Record<RegistrationRelationship, readonly IdentityCapability[]> = {
  owner: [
    'registration.view',
    'registration.edit',
    'registration.invite',
    'registration.transfer',
    'registration.delete',
  ],
  manager: ['registration.view', 'registration.edit'],
}

const SENSITIVE_CAPABILITIES = new Set<IdentityCapability>([
  'platform.access.manage',
  'platform.identity.review',
  'tournament.access.manage',
  'registration.invite',
  'registration.transfer',
  'registration.delete',
])

export const STAFF_RECENT_AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const SENSITIVE_RECENT_AUTH_MAX_AGE_MS = 15 * 60 * 1000
export const PHISHING_RESISTANT_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const RECENT_PHISHING_RESISTANT_MAX_AGE_MS = 15 * 60 * 1000

export function isIdentityCapability(value: unknown): value is IdentityCapability {
  if (typeof value !== 'string') return false
  return IDENTITY_CAPABILITIES.some(capability => capability === value)
}

export function rolesForCapability(capability: IdentityCapability) {
  return (Object.keys(ROLE_CAPABILITIES) as IdentityRole[]).filter(role =>
    ROLE_CAPABILITIES[role].includes(capability),
  )
}

export function relationshipsForCapability(capability: IdentityCapability) {
  return (Object.keys(RELATIONSHIP_CAPABILITIES) as RegistrationRelationship[]).filter(
    relationship => RELATIONSHIP_CAPABILITIES[relationship].includes(capability),
  )
}

export function minimumAssurance(capability: IdentityCapability): AssuranceRequirement {
  if (SENSITIVE_CAPABILITIES.has(capability)) return 'recent'
  return capability.startsWith('tournament.') || capability.startsWith('platform.')
    ? 'recent'
    : 'base'
}

export function effectiveAssurance(
  capability: IdentityCapability,
  requested: AssuranceRequirement | undefined,
): EffectiveAssurancePolicy | null {
  const known = new Set<AssuranceRequirement>([
    'base',
    'recent',
    'phishing_resistant',
    'recent_phishing_resistant',
  ])
  if (requested && !known.has(requested)) return null
  const minimum = minimumAssurance(capability)
  const staffCapability = capability.startsWith('tournament.') || capability.startsWith('platform.')
  const minimumAuthenticationAge = SENSITIVE_CAPABILITIES.has(capability)
    ? SENSITIVE_RECENT_AUTH_MAX_AGE_MS
    : staffCapability
      ? STAFF_RECENT_AUTH_MAX_AGE_MS
      : null
  const requestedAuthenticationAge =
    requested === 'recent' || requested === 'recent_phishing_resistant'
      ? SENSITIVE_RECENT_AUTH_MAX_AGE_MS
      : null
  const requestedPhishingAge =
    requested === 'recent_phishing_resistant'
      ? RECENT_PHISHING_RESISTANT_MAX_AGE_MS
      : requested === 'phishing_resistant'
        ? PHISHING_RESISTANT_MAX_AGE_MS
        : null
  const ages = [minimumAuthenticationAge, requestedAuthenticationAge].filter(
    (value): value is number => value !== null,
  )
  return {
    label: !requested || requested === 'base' ? minimum : requested,
    authenticatedMaxAgeMs: ages.length ? Math.min(...ages) : null,
    phishingResistantMaxAgeMs: requestedPhishingAge,
  }
}
