import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings.ts'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  setCeremonyCookie,
} from '../passkey-ceremony.ts'
import {
  participantAuthenticationOptions,
  participantRegistrationOptions,
  verifyParticipantAuthentication,
  verifyParticipantRegistration,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '../participant-passkeys.ts'
import { resolveWebAuthnConfig } from '../webauthn-config.ts'
import { activeAuthFingerprintKey } from './internal/auth-fingerprint-config.ts'
import { createAuthAttemptFingerprint } from './internal/auth-fingerprint.ts'
import { AuthAttemptRateLimitError, chargeAuthAttempts } from './internal/auth-attempts.ts'
import { networkAuthAttemptCharge } from './internal/auth-network.ts'
import {
  completeVerifiedPasskeyAuthentication,
  passkeyAuthenticationCredential,
  type PasskeySessionReplacement,
} from './internal/passkey-authentication.ts'
import {
  listAccountPasskeys,
  revokeAccountPasskey,
  type AccountPasskey,
} from './internal/passkey-credentials.ts'
import {
  claimPasskeyEnrollmentAttempt,
  completePasskeyEnrollment,
  preparePasskeyEnrollment,
} from './internal/passkey-enrollment.ts'
import { claimPasskeyIntentAttempt, issuePasskeyIntent } from './internal/passkey-intent.ts'
import {
  clearLegacyPasskeyCookies,
  replacementFromPasskeyRequest,
} from './internal/passkey-legacy-session.ts'
import { IdentityPasskeyError, validPasskeyCredentialId } from './internal/passkey-shared.ts'
import { clientSessionLabel } from './internal/session-display.ts'
import type { AuthenticatedAuthContext } from './internal/contracts.ts'
import { isIdentityRedirectKey, resolveIdentityRedirect } from './redirects.ts'
import { isParticipantReturnPath } from '../participant-return.ts'

export type { AccountPasskey, AuthenticationResponseJSON, RegistrationResponseJSON }
export {
  AuthAttemptRateLimitError,
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  IdentityPasskeyError,
  setCeremonyCookie,
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/

function signInDestination(redirectKey: unknown, tournamentSlug: unknown, returnTo: unknown) {
  const key = isIdentityRedirectKey(redirectKey) ? redirectKey : 'account'
  const context: Record<string, string> = {}
  if (typeof tournamentSlug === 'string' && SLUG.test(tournamentSlug)) {
    context.tournamentSlug = tournamentSlug
  }
  if (isParticipantReturnPath(returnTo)) context.returnTo = returnTo
  return { key, context }
}

export async function beginPasskeySignIn(input: {
  headers: Pick<Headers, 'get'>
  redirectKey?: unknown
  tournamentSlug?: unknown
  returnTo?: unknown
  now?: number
}) {
  const now = input.now ?? Date.now()
  const database = cloudflareBindings().db
  const fingerprintKey = await activeAuthFingerprintKey()
  await chargeAuthAttempts(
    database,
    'passkey_authentication',
    [await networkAuthAttemptCharge(input.headers, 'passkey_authentication', fingerprintKey, 50)],
    now,
  )
  const destination = signInDestination(input.redirectKey, input.tournamentSlug, input.returnTo)
  const intent = await issuePasskeyIntent(database, {
    purpose: 'passkey_sign_in',
    redirectKey: destination.key,
    context: destination.context,
    now,
  })
  return {
    options: await participantAuthenticationOptions({
      config: resolveWebAuthnConfig(),
      challenge: intent.challenge,
    }),
    ceremonySecret: intent.secret,
    expiresAt: intent.expiresAt,
  }
}

export async function verifyPasskeySignIn(input: {
  ceremonySecret: string
  response: AuthenticationResponseJSON
  replacement?: PasskeySessionReplacement
  headers?: Pick<Headers, 'get'>
  now?: number
}) {
  const now = input.now ?? Date.now()
  const database = cloudflareBindings().db
  const intent = await claimPasskeyIntentAttempt(database, {
    purpose: 'passkey_sign_in',
    secret: input.ceremonySecret,
    now,
  })
  if (!validPasskeyCredentialId(input.response?.id)) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  const verificationCredential = await passkeyAuthenticationCredential(database, input.response.id)
  if (input.response.response.userHandle !== verificationCredential.userHandle) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  let verification: Awaited<ReturnType<typeof verifyParticipantAuthentication>>
  try {
    verification = await verifyParticipantAuthentication({
      config: resolveWebAuthnConfig(),
      challenge: intent.challenge,
      response: input.response,
      credential: {
        id: verificationCredential.id,
        publicKey: verificationCredential.publicKey,
        counter: verificationCredential.counter,
        transports: verificationCredential.transports as WebAuthnCredential['transports'],
      },
    })
  } catch {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  if (!verification.verified) throw new IdentityPasskeyError('invalid_ceremony')
  const result = await completeVerifiedPasskeyAuthentication(database, {
    intent,
    credential: verificationCredential,
    verification: {
      newCounter: verification.authenticationInfo.newCounter,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
    },
    replacement: input.replacement,
    clientLabel: input.headers ? clientSessionLabel(input.headers) : undefined,
    now,
  })
  const key = isIdentityRedirectKey(result.redirectKey) ? result.redirectKey : 'account'
  const returnTo = result.redirectContext.returnTo
  return {
    ...result,
    redirectTo: isParticipantReturnPath(returnTo)
      ? returnTo
      : resolveIdentityRedirect(key, result.redirectContext),
  }
}

export async function beginPasskeyEnrollment(input: {
  context: AuthenticatedAuthContext
  headers: Pick<Headers, 'get'>
  label?: unknown
  now?: number
}) {
  const now = input.now ?? Date.now()
  const database = cloudflareBindings().db
  const fingerprintKey = await activeAuthFingerprintKey()
  const [network, account] = await Promise.all([
    networkAuthAttemptCharge(input.headers, 'passkey_registration', fingerprintKey, 50),
    createAuthAttemptFingerprint(
      fingerprintKey,
      'passkey_registration',
      'account',
      input.context.account.id,
    ).then(value => ({ dimension: 'account' as const, ...value, limit: 10 })),
  ])
  await chargeAuthAttempts(database, 'passkey_registration', [network, account], now)
  const prepared = await preparePasskeyEnrollment(database, {
    context: input.context,
    label: input.label,
    now,
  })
  return {
    options: await participantRegistrationOptions({
      config: resolveWebAuthnConfig(),
      challenge: prepared.intent.challenge,
      userHandle: prepared.userHandle,
      accountLabel: prepared.accountLabel,
      displayLabel: prepared.displayLabel,
      excludeCredentialIds: prepared.excludeCredentialIds,
    }),
    ceremonySecret: prepared.intent.secret,
    expiresAt: prepared.intent.expiresAt,
  }
}

export async function verifyPasskeyEnrollment(input: {
  context: AuthenticatedAuthContext
  ceremonySecret: string
  response: RegistrationResponseJSON
  now?: number
}) {
  const now = input.now ?? Date.now()
  const database = cloudflareBindings().db
  const intent = await claimPasskeyEnrollmentAttempt(database, {
    context: input.context,
    secret: input.ceremonySecret,
    now,
  })
  let verification: Awaited<ReturnType<typeof verifyParticipantRegistration>>
  try {
    verification = await verifyParticipantRegistration({
      config: resolveWebAuthnConfig(),
      challenge: intent.challenge,
      response: input.response,
    })
  } catch {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  const info = verification.registrationInfo
  return completePasskeyEnrollment(database, {
    context: input.context,
    intent,
    registration: {
      credential: {
        id: info.credential.id,
        publicKey: info.credential.publicKey,
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
      },
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    },
    now,
  })
}

export function accountPasskeys(context: AuthenticatedAuthContext, now = Date.now()) {
  return listAccountPasskeys(cloudflareBindings().db, context, now)
}

export function revokePasskey(
  context: AuthenticatedAuthContext,
  credentialId: string,
  now = Date.now(),
) {
  return revokeAccountPasskey(cloudflareBindings().db, context, credentialId, now)
}

export function passkeySessionReplacement(
  request: Parameters<typeof replacementFromPasskeyRequest>[0],
) {
  return replacementFromPasskeyRequest(request)
}

export function clearPasskeyLegacyCookies<
  ResponseType extends Parameters<typeof clearLegacyPasskeyCookies>[0],
>(response: ResponseType) {
  return clearLegacyPasskeyCookies(response)
}
