import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings.ts'
import {
  clearIdentitySessionCookie,
  identitySessionCookie,
  IDENTITY_SESSION_COOKIE_NAME,
  readIdentitySessionToken,
  setIdentitySessionCookie,
} from './internal/cookie.ts'
import type {
  AuthContext,
  IdentityDatabase,
  IdentityKernelDependencies,
  SessionDraft,
} from './internal/contracts.ts'
import { authorize as authorizeAgainstDatabase } from './internal/authorization.ts'
import { touchSessionActivity } from './internal/session-activity.ts'
import {
  createSessionDraft,
  prepareSessionInsert,
  RECOVERY_SESSION_ABSOLUTE_MS,
  RECOVERY_SESSION_IDLE_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './internal/session-draft.ts'
import { resolveAuthContext } from './internal/session-resolution.ts'
import { revokeSession as revokeDatabaseSession } from './internal/session-revocation.ts'
import type {
  AssuranceRequirement,
  AuthorizationDecision,
  AuthorizationResource,
  IdentityCapability,
} from './internal/policy.ts'

export type {
  AnonymousAuthContext,
  AuthContext,
  AuthenticatedAuthContext,
  CreateSessionDraftInput,
  IdentityAuthMethod,
  IdentityDatabase,
  SessionAuthentication,
  SessionDraft,
  VerificationState,
} from './internal/contracts.ts'
export type {
  AssuranceRequirement,
  AuthorizationDecision,
  AuthorizationResource,
  IdentityCapability,
  IdentityRole,
  RegistrationRelationship,
  ResolvedAuthorizationResource,
} from './internal/policy.ts'
export { IDENTITY_CAPABILITIES } from './internal/policy.ts'
export {
  clearIdentitySessionCookie,
  createSessionDraft,
  identitySessionCookie,
  IDENTITY_SESSION_COOKIE_NAME,
  RECOVERY_SESSION_ABSOLUTE_MS,
  RECOVERY_SESSION_IDLE_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  setIdentitySessionCookie,
}

export interface GetAuthContextOptions extends IdentityKernelDependencies {
  /** Supplying token, including null, is the explicit transport seam for tests and non-HTTP jobs. */
  token?: string | null
}

export interface AuthorizeOptions extends IdentityKernelDependencies {
  /** May strengthen but can never weaken the capability's built-in requirement. */
  assurance?: AssuranceRequirement
}

export interface RevokeSessionOptions extends IdentityKernelDependencies {
  requestCorrelationId?: string
}

function databaseFrom(options: IdentityKernelDependencies) {
  return options.database ?? cloudflareBindings().db
}

export async function getAuthContext(options: GetAuthContextOptions = {}): Promise<AuthContext> {
  const explicitToken = Object.prototype.hasOwnProperty.call(options, 'token')
  const token = explicitToken ? (options.token ?? null) : await readIdentitySessionToken()
  const database = databaseFrom(options)
  const now = options.now ?? Date.now()
  const context = await resolveAuthContext(database, token, now)
  return touchSessionActivity(database, context, now)
}

export async function authorize(
  context: AuthContext,
  capability: IdentityCapability,
  resource: AuthorizationResource,
  options: AuthorizeOptions = {},
): Promise<AuthorizationDecision> {
  return authorizeAgainstDatabase(
    databaseFrom(options),
    context,
    capability,
    resource,
    options.assurance,
    options.now,
  )
}

export async function revokeSession(
  context: AuthContext,
  reason: string,
  options: RevokeSessionOptions = {},
) {
  return revokeDatabaseSession(
    databaseFrom(options),
    context,
    reason,
    options.now,
    options.requestCorrelationId,
  )
}

/**
 * A ceremony service batches this statement with its credential/intent transition and security
 * event. Calling it alone would violate the unified identity transaction contract.
 */
export function sessionInsertStatement(database: IdentityDatabase, draft: SessionDraft) {
  return prepareSessionInsert(database, draft)
}
