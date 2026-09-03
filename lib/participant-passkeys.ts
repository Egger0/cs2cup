import 'server-only'

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server'
import { base64UrlToBytes } from './opaque-token.ts'
import type { WebAuthnConfig } from './webauthn-config.ts'

export const PASSKEY_CEREMONY_TTL_MS = 5 * 60 * 1000

export async function participantRegistrationOptions(input: {
  config: WebAuthnConfig
  challenge: string
  userHandle: string
  accountLabel: string
  displayLabel: string
  excludeCredentialIds?: readonly string[]
}) {
  return generateRegistrationOptions({
    rpName: input.config.rpName,
    rpID: input.config.rpID,
    userID: base64UrlToBytes(input.userHandle),
    userName: input.accountLabel,
    userDisplayName: input.displayLabel,
    challenge: base64UrlToBytes(input.challenge),
    timeout: PASSKEY_CEREMONY_TTL_MS,
    attestationType: 'none',
    excludeCredentials: input.excludeCredentialIds?.map(id => ({ id })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  })
}

export function verifyParticipantRegistration(input: {
  config: WebAuthnConfig
  challenge: string
  response: RegistrationResponseJSON
}) {
  return verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.config.origin,
    expectedRPID: input.config.rpID,
    requireUserVerification: true,
  })
}

export function participantAuthenticationOptions(input: {
  config: WebAuthnConfig
  challenge: string
}) {
  return generateAuthenticationOptions({
    rpID: input.config.rpID,
    challenge: base64UrlToBytes(input.challenge),
    timeout: PASSKEY_CEREMONY_TTL_MS,
    allowCredentials: [],
    userVerification: 'required',
  })
}

export function verifyParticipantAuthentication(input: {
  config: WebAuthnConfig
  challenge: string
  response: AuthenticationResponseJSON
  credential: WebAuthnCredential
}) {
  return verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: input.challenge,
    expectedOrigin: input.config.origin,
    expectedRPID: input.config.rpID,
    credential: input.credential,
    requireUserVerification: true,
  })
}

export type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential }
