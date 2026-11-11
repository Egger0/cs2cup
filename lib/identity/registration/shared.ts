import 'server-only'

import { authorize } from '../internal/authorization.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import { privateSessionContext } from '../internal/session-context.ts'
import { resolveAuthContextFromHash } from '../internal/session-resolution.ts'
import { RegistrationWorkflowError } from './types.ts'

export const REGISTRATION_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/
export const REGISTRATION_RECENT_AUTH_MS = 15 * 60 * 1000

export function validRegistrationTime(now: number) {
  return Number.isSafeInteger(now) && now >= 0
}

export function requireRecentRegistrationAuth(context: AuthenticatedAuthContext, now: number) {
  if (
    context.session.recoveryRestricted ||
    context.session.authenticatedAt > now ||
    context.session.authenticatedAt < now - REGISTRATION_RECENT_AUTH_MS
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
}

export async function requireActiveRegistrationSession(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  if (context.session.recoveryRestricted || !validRegistrationTime(now)) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  const privateContext = privateSessionContext(context)
  if (!privateContext) throw new RegistrationWorkflowError('reauth_required')
  const authoritative = await resolveAuthContextFromHash(database, privateContext.tokenHash, now)
  if (
    authoritative.kind === 'anonymous' ||
    authoritative.account.id !== context.account.id ||
    authoritative.session.id !== context.session.id ||
    authoritative.session.recoveryRestricted
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  return authoritative
}

export async function requireRegistrationCapability(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  capability: 'registration.view' | 'registration.edit' | 'registration.delete',
  now: number,
) {
  const decision = await authorize(
    database,
    context,
    capability,
    { kind: 'registration', registrationId: teamId },
    undefined,
    now,
  )
  if (decision.ok) return decision
  if (
    decision.reason === 'assurance_required' ||
    decision.reason === 'recovery_restricted' ||
    decision.reason === 'session_invalid'
  ) {
    throw new RegistrationWorkflowError('reauth_required')
  }
  throw new RegistrationWorkflowError('forbidden')
}
