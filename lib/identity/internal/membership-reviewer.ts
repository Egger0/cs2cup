import 'server-only'

import { authorize } from './authorization.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import type { MembershipApplicationRow } from './membership-store.ts'
import { securityEventStatement } from './security-event.ts'

export type ReviewerFailure =
  | 'invalid_input'
  | 'session_invalid'
  | 'reauthentication_required'
  | 'forbidden'

export async function reviewerAuthorizationFailure(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
): Promise<ReviewerFailure | null> {
  const decision = await authorize(
    database,
    context,
    'platform.identity.review',
    { kind: 'platform' },
    undefined,
    now,
  )
  if (decision.ok) return null
  if (decision.reason === 'session_invalid' || decision.reason === 'recovery_restricted') {
    return 'session_invalid'
  }
  if (decision.reason === 'assurance_required') return 'reauthentication_required'
  return 'forbidden'
}

export async function reviewerSecurityEvent(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  application: MembershipApplicationRow,
  eventType: string,
  operation: { now: number; correlationId: string },
  details: Readonly<Record<string, unknown>>,
  deduplicationScope = `${eventType}:${application.id}:${operation.correlationId}`,
) {
  return securityEventStatement(database, {
    eventType,
    actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
    targetAccountId: application.account_id,
    resource: { type: 'membership_application', id: application.id },
    correlationId: operation.correlationId,
    deduplicationScope,
    details,
    retentionClass: 'access_control',
    createdAt: operation.now,
  })
}
