import 'server-only'

import type { AuthContext, AuthenticatedAuthContext } from './contracts.ts'

interface PrivateSessionContext {
  tokenHash: string
  revision: number
}

const privateSessionContexts = new WeakMap<AuthenticatedAuthContext, PrivateSessionContext>()

export function rememberSessionContext(
  context: AuthenticatedAuthContext,
  tokenHash: string,
  revision: number,
) {
  privateSessionContexts.set(context, { tokenHash, revision })
  return context
}

export function privateSessionContext(context: AuthContext) {
  return context.kind === 'authenticated' ? (privateSessionContexts.get(context) ?? null) : null
}

export function sessionHashForContext(context: AuthContext) {
  return privateSessionContext(context)?.tokenHash ?? null
}

export function contextWithActivity(
  context: AuthenticatedAuthContext,
  lastSeenAt: number,
  idleExpiresAt: number,
  revision: number,
) {
  const privateContext = privateSessionContext(context)
  if (!privateContext) return null
  const next: AuthenticatedAuthContext = Object.freeze({
    ...context,
    session: Object.freeze({ ...context.session, lastSeenAt, idleExpiresAt }),
  })
  return rememberSessionContext(next, privateContext.tokenHash, revision)
}
