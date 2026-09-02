import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { bytesToBase64Url } from '@/lib/opaque-token'
import { createParticipantSessionDraft, setParticipantSessionCookie } from '@/lib/participant-auth'
import { ceremonyTokenFromRequest, clearCeremonyCookie } from '@/lib/passkey-ceremony'
import { passkeyError, privateEmpty, readPasskeyJson } from '@/lib/passkey-http'
import {
  type RegistrationResponseJSON,
  verifyParticipantRegistration,
} from '@/lib/participant-passkeys'
import { consumePasskeyCeremony } from '@/lib/queries/participant-passkey-challenges'
import { finishParticipantClaim } from '@/lib/queries/participant-passkey-credentials'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

function claimVerificationError(error: unknown) {
  if (error instanceof CsrfError) return passkeyError(403, '请求来源无法确认，请刷新页面重试。')
  return passkeyError(400)
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const ceremonyToken = ceremonyTokenFromRequest(request)
    if (!ceremonyToken) throw new Error('missing ceremony')
    const response = await readPasskeyJson<RegistrationResponseJSON>(request)
    const now = Date.now()
    const db = cloudflareBindings().db
    const ceremony = await consumePasskeyCeremony(db, {
      token: ceremonyToken,
      kind: 'claim',
      now,
    })
    const verification = await verifyParticipantRegistration({
      config: resolveWebAuthnConfig(),
      challenge: ceremony.challenge,
      response,
    })
    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('registration not verified')
    }
    const info = verification.registrationInfo
    const session = await createParticipantSessionDraft()
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
    return clearCeremonyCookie(setParticipantSessionCookie(privateEmpty(), session.token))
  } catch (error) {
    return clearCeremonyCookie(claimVerificationError(error))
  }
}
