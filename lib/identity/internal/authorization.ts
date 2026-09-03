import 'server-only'

import {
  validPositiveId,
  validTimestamp,
  type AuthContext,
  type IdentityDatabase,
} from './contracts.ts'
import {
  effectiveAssurance,
  isIdentityCapability,
  relationshipsForCapability,
  rolesForCapability,
  type AssuranceRequirement,
  type AuthorizationDecision,
  type AuthorizationResource,
  type IdentityCapability,
  type EffectiveAssurancePolicy,
  type ResolvedAuthorizationResource,
} from './policy.ts'
import { sessionHashForContext } from './session-context.ts'

interface AuthorizationRow {
  session_valid: number
  recovery_restricted: number
  assurance_valid: number
  allowed: number
  tournament_id: number | null
}

interface AuthorizationPlan {
  query: string
  bindings: unknown[]
  resolveResource(tournamentId: number | null): ResolvedAuthorizationResource | null
}

const validSessionCte = `valid_session AS (
  SELECT session.account_id, session.recovery_restricted, session.authenticated_at,
         session.phishing_resistant_at
  FROM identity_session AS session
  JOIN identity_account AS account ON account.id = session.account_id
  WHERE session.token_hash = ? AND session.id = ? AND session.account_id = ?
    AND session.revoked_at IS NULL
    AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
    AND session.authenticated_at <= ?
    AND (session.phishing_resistant_at IS NULL OR session.phishing_resistant_at <= ?)
    AND (session.recovery_verified_at IS NULL OR session.recovery_verified_at <= ?)
    AND account.status = 'active' AND account.security_version = session.security_version
    AND session.auth_method != 'bootstrap'
    AND (session.recovery_restricted = 1 OR session.auth_method IN ('passkey', 'password'))
    AND ((session.auth_method = 'password'
      AND length(session.password_credential_id) = 43
      AND session.password_credential_id NOT GLOB '*[^A-Za-z0-9_-]*'
      AND length(session.password_verification_nonce) = 43
      AND session.password_verification_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
      OR (session.auth_method != 'password' AND session.password_credential_id IS NULL
        AND session.password_verification_nonce IS NULL))
    AND (session.auth_method != 'password' OR EXISTS (
      SELECT 1 FROM identity_password_credential AS password
      WHERE password.id = session.password_credential_id
        AND password.account_id = session.account_id AND password.status = 'active'
    ))
    AND (session.auth_method != 'passkey' OR EXISTS (
      SELECT 1 FROM identity_passkey_credential AS credential
      JOIN identity_auth_intent AS intent ON intent.id = session.passkey_auth_intent_id
      WHERE credential.credential_id = session.authenticator_credential_id
        AND credential.account_id = session.account_id AND credential.status = 'active'
        AND intent.purpose IN ('passkey_sign_in', 'passkey_step_up')
        AND (intent.expected_account_id IS NULL OR intent.expected_account_id = session.account_id)
        AND intent.consumed_at = session.authenticated_at
        AND intent.completion_result_type = 'passkey_credential'
        AND intent.completion_result_ref = credential.credential_id
        AND session.phishing_resistant_at = intent.consumed_at
    ))
)`

function assuranceSql(policy: EffectiveAssurancePolicy, now: number) {
  const conditions = ['recovery_restricted = 0']
  const bindings: number[] = []
  if (policy.authenticatedMaxAgeMs !== null) {
    conditions.push('authenticated_at >= ?')
    bindings.push(now - policy.authenticatedMaxAgeMs)
  }
  if (policy.phishingResistantMaxAgeMs !== null) {
    conditions.push('phishing_resistant_at IS NOT NULL AND phishing_resistant_at >= ?')
    bindings.push(now - policy.phishingResistantMaxAgeMs)
  }
  return { condition: conditions.join(' AND '), bindings }
}

function resultSql() {
  return `SELECT
    EXISTS(SELECT 1 FROM valid_session) AS session_valid,
    COALESCE((SELECT recovery_restricted FROM valid_session LIMIT 1), 0) AS recovery_restricted,
    EXISTS(SELECT 1 FROM assured_session) AS assurance_valid,
    EXISTS(SELECT 1 FROM allowed_access) AS allowed,
    (SELECT tournament_id FROM concrete_resource LIMIT 1) AS tournament_id`
}

function commonBindings(
  context: Extract<AuthContext, { kind: 'authenticated' }>,
  hash: string,
  now: number,
) {
  return [hash, context.session.id, context.account.id, now, now, now, now, now]
}

function resourceCte(resource: Exclude<AuthorizationResource, { kind: 'platform' }>) {
  if (resource.kind === 'tournament') {
    return {
      sql: 'concrete_resource AS (SELECT id AS tournament_id FROM tournament WHERE id = ?)',
      binding: resource.tournamentId,
      resolve: (tournamentId: number | null) =>
        tournamentId === resource.tournamentId
          ? ({ kind: 'tournament', tournamentId } as const)
          : null,
    }
  }
  return {
    sql: `concrete_resource AS (
      SELECT team.tournament_id
      FROM team JOIN tournament ON tournament.id = team.tournament_id
      WHERE team.id = ?
    )`,
    binding: resource.registrationId,
    resolve: (tournamentId: number | null) => {
      if (!validPositiveId(tournamentId ?? 0) || tournamentId === null) return null
      return {
        kind: 'registration',
        registrationId: resource.registrationId,
        tournamentId,
      } as const
    },
  }
}

function platformPlan(
  context: Extract<AuthContext, { kind: 'authenticated' }>,
  hash: string,
  capability: IdentityCapability,
  requirement: EffectiveAssurancePolicy,
  now: number,
): AuthorizationPlan {
  const assurance = assuranceSql(requirement, now)
  const roles = rolesForCapability(capability)
  const placeholders = roles.map(() => '?').join(', ')
  const query = `WITH ${validSessionCte},
    assured_session AS (SELECT * FROM valid_session WHERE ${assurance.condition}),
    concrete_resource AS (SELECT NULL AS tournament_id),
    allowed_access AS (
      SELECT 1 FROM assured_session
      JOIN identity_role_assignment AS assignment
        ON assignment.account_id = assured_session.account_id
      WHERE assignment.role IN (${placeholders}) AND assignment.scope_type = 'platform'
        AND assignment.scope_tournament_id IS NULL AND assignment.revoked_at IS NULL
        AND assignment.granted_at <= ?
        AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)
      LIMIT 1
    ) ${resultSql()}`
  return {
    query,
    bindings: [...commonBindings(context, hash, now), ...assurance.bindings, ...roles, now, now],
    resolveResource: () => ({ kind: 'platform' }),
  }
}

function tournamentPlan(
  context: Extract<AuthContext, { kind: 'authenticated' }>,
  hash: string,
  capability: IdentityCapability,
  resource: Exclude<AuthorizationResource, { kind: 'platform' }>,
  requirement: EffectiveAssurancePolicy,
  now: number,
): AuthorizationPlan {
  const assurance = assuranceSql(requirement, now)
  const concrete = resourceCte(resource)
  const scopedRoles = rolesForCapability(capability).filter(role => role !== 'platform_owner')
  const placeholders = scopedRoles.map(() => '?').join(', ')
  const scopedClause = scopedRoles.length
    ? `(assignment.scope_type = 'tournament'
       AND assignment.scope_tournament_id = concrete_resource.tournament_id
       AND assignment.role IN (${placeholders}))`
    : '0 = 1'
  const query = `WITH ${validSessionCte},
    assured_session AS (SELECT * FROM valid_session WHERE ${assurance.condition}),
    ${concrete.sql},
    allowed_access AS (
      SELECT 1 FROM assured_session
      JOIN identity_role_assignment AS assignment
        ON assignment.account_id = assured_session.account_id
      JOIN concrete_resource
      WHERE assignment.revoked_at IS NULL AND assignment.granted_at <= ?
        AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)
        AND ((assignment.role = 'platform_owner' AND assignment.scope_type = 'platform'
          AND assignment.scope_tournament_id IS NULL) OR ${scopedClause})
      LIMIT 1
    ) ${resultSql()}`
  return {
    query,
    bindings: [
      ...commonBindings(context, hash, now),
      ...assurance.bindings,
      concrete.binding,
      now,
      now,
      ...scopedRoles,
    ],
    resolveResource: concrete.resolve,
  }
}

function registrationPlan(
  context: Extract<AuthContext, { kind: 'authenticated' }>,
  hash: string,
  capability: IdentityCapability,
  resource: Extract<AuthorizationResource, { kind: 'registration' }>,
  requirement: EffectiveAssurancePolicy,
  now: number,
): AuthorizationPlan {
  const assurance = assuranceSql(requirement, now)
  const concrete = resourceCte(resource)
  const relationships = relationshipsForCapability(capability)
  const placeholders = relationships.map(() => '?').join(', ')
  const query = `WITH ${validSessionCte},
    assured_session AS (SELECT * FROM valid_session WHERE ${assurance.condition}),
    ${concrete.sql},
    allowed_access AS (
      SELECT 1 FROM assured_session
      JOIN identity_registration_membership AS membership
        ON membership.account_id = assured_session.account_id
      JOIN concrete_resource
      WHERE membership.team_id = ? AND membership.relationship IN (${placeholders})
        AND membership.revoked_at IS NULL AND membership.granted_at <= ?
        AND (membership.expires_at IS NULL OR membership.expires_at > ?)
      LIMIT 1
    ) ${resultSql()}`
  return {
    query,
    bindings: [
      ...commonBindings(context, hash, now),
      ...assurance.bindings,
      concrete.binding,
      resource.registrationId,
      ...relationships,
      now,
      now,
    ],
    resolveResource: concrete.resolve,
  }
}

export async function authorize(
  database: IdentityDatabase,
  context: AuthContext,
  capability: IdentityCapability,
  resource: AuthorizationResource,
  requestedAssurance: AssuranceRequirement | undefined,
  now = Date.now(),
): Promise<AuthorizationDecision> {
  if (context.kind === 'anonymous') return { ok: false, reason: 'anonymous' }
  const tokenHash = sessionHashForContext(context)
  if (!tokenHash || !isIdentityCapability(capability) || !validTimestamp(now)) {
    return { ok: false, reason: 'invalid_request' }
  }
  const assurance = effectiveAssurance(capability, requestedAssurance)
  if (!assurance) return { ok: false, reason: 'invalid_request' }
  const validResource =
    resource &&
    (resource.kind === 'platform' ||
      (resource.kind === 'tournament' && validPositiveId(resource.tournamentId)) ||
      (resource.kind === 'registration' && validPositiveId(resource.registrationId)))
  if (!validResource) return { ok: false, reason: 'invalid_request' }

  let plan: AuthorizationPlan
  if (capability.startsWith('platform.')) {
    if (resource.kind !== 'platform') return { ok: false, reason: 'invalid_request' }
    plan = platformPlan(context, tokenHash, capability, assurance, now)
  } else if (capability.startsWith('registration.')) {
    if (resource.kind !== 'registration') return { ok: false, reason: 'invalid_request' }
    plan = registrationPlan(context, tokenHash, capability, resource, assurance, now)
  } else {
    if (resource.kind === 'platform') return { ok: false, reason: 'invalid_request' }
    plan = tournamentPlan(context, tokenHash, capability, resource, assurance, now)
  }

  const row = await database
    .prepare(plan.query)
    .bind(...plan.bindings)
    .first<AuthorizationRow>()
  if (row?.session_valid !== 1) return { ok: false, reason: 'session_invalid' }
  if (row.recovery_restricted === 1) return { ok: false, reason: 'recovery_restricted' }
  if (row.assurance_valid !== 1) return { ok: false, reason: 'assurance_required' }
  const resolvedResource = plan.resolveResource(row.tournament_id)
  if (row.allowed !== 1 || !resolvedResource) return { ok: false, reason: 'forbidden' }
  return {
    ok: true,
    accountId: context.account.id,
    capability,
    resource: resolvedResource,
    assurance: assurance.label,
  }
}
