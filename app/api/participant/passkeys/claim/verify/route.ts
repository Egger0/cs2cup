import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest } from '@/lib/csrf'
import { bytesToBase64Url } from '@/lib/opaque-token'
import {
  createParticipantSessionDraft,
  getCurrentParticipant,
  setParticipantSessionCookie,
} from '@/lib/participant-auth'
import { ceremonyTokenFromRequest, clearCeremonyCookie } from '@/lib/passkey-ceremony'
import {
  ParticipantRegistrationRejected,
  participantClaimVerificationFailure,
} from '@/lib/passkey-claim-verification'
import { passkeyError, privateEmpty, readPasskeyJson } from '@/lib/passkey-http'
import {
  type RegistrationResponseJSON,
  verifyParticipantRegistration,
} from '@/lib/participant-passkeys'
import { consumePasskeyCeremony } from '@/lib/queries/participant-passkey-challenges'
import { finishParticipantClaim } from '@/lib/queries/participant-passkey-credentials'
import { ParticipantPasskeyError } from '@/lib/queries/participant-passkey-shared'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

function claimVerificationError(error: unknown) {
  const failure = participantClaimVerificationFailure(error)
  return passkeyError(failure.status, failure.message)
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    if (await getCurrentParticipant()) {
      return clearCeremonyCookie(
        passkeyError(409, '当前赛事通行已打开，请刷新页面后加入当前通行证。'),
      )
    }
    const ceremonyToken = ceremonyTokenFromRequest(request)
    if (!ceremonyToken) throw new ParticipantPasskeyError('invalid_challenge')
    const response = await readPasskeyJson<RegistrationResponseJSON>(request)
    const now = Date.now()
    const db = cloudflareBindings().db
    const ceremony = await consumePasskeyCeremony(db, {
      token: ceremonyToken,
      kind: 'claim',
      now,
    })
    const config = resolveWebAuthnConfig()
    let verification: Awaited<ReturnType<typeof verifyParticipantRegistration>>
    try {
      verification = await verifyParticipantRegistration({
        config,
        challenge: ceremony.challenge,
        response,
      })
    } catch {
      throw new ParticipantRegistrationRejected()
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new ParticipantRegistrationRejected()
    }
    const info = verification.registrationInfo
    const session = await createParticipantSessionDraft()
    // Prepare both cookies before the atomic write. A later response-construction
    // failure therefore cannot leave a committed claim reported as a 5xx.
    const successResponse = clearCeremonyCookie(
      setParticipantSessionCookie(privateEmpty(), session.token),
    )
    await finishParticipantClaim(db, {
      ceremony,
      credential: {
        id: info.credential.id,
        publicKey: bytesToBase64Url(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
      },
      session,
      now,
    })
    return successResponse
  } catch (error) {
    return clearCeremonyCookie(claimVerificationError(error))
  }
}
