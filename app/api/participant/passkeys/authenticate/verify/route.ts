import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { base64UrlToBytes } from '@/lib/opaque-token'
import {
  createParticipantSessionDraft,
  getCurrentParticipant,
  setParticipantSessionCookie,
} from '@/lib/participant-auth'
import { ceremonyTokenFromRequest, clearCeremonyCookie } from '@/lib/passkey-ceremony'
import { passkeyError, privateEmpty, readPasskeyJson } from '@/lib/passkey-http'
import {
  type AuthenticationResponseJSON,
  verifyParticipantAuthentication,
} from '@/lib/participant-passkeys'
import { consumePasskeyCeremony } from '@/lib/queries/participant-passkey-challenges'
import {
  finishParticipantAuthentication,
  participantCredentialById,
} from '@/lib/queries/participant-passkey-credentials'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

function authenticationVerificationError(error: unknown) {
  if (error instanceof CsrfError) return passkeyError(403, '请求来源无法确认，请刷新页面重试。')
  return passkeyError(400)
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    if (await getCurrentParticipant()) {
      return clearCeremonyCookie(passkeyError(409, '当前赛事通行已打开，请返回继续。'))
    }
    const ceremonyToken = ceremonyTokenFromRequest(request)
    if (!ceremonyToken) throw new Error('missing ceremony')
    const response = await readPasskeyJson<AuthenticationResponseJSON>(request)
    const now = Date.now()
    const db = cloudflareBindings().db
    const ceremony = await consumePasskeyCeremony(db, {
      token: ceremonyToken,
      kind: 'authentication',
      now,
    })
    const credential = await participantCredentialById(db, response.id)
    if (response.response.userHandle !== credential.userHandle) {
      throw new Error('unexpected user handle')
    }
    const verification = await verifyParticipantAuthentication({
      config: resolveWebAuthnConfig(),
      challenge: ceremony.challenge,
      response,
      credential: {
        id: credential.id,
        publicKey: base64UrlToBytes(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
      },
    })
    if (!verification.verified) throw new Error('authentication not verified')
    const session = await createParticipantSessionDraft()
    await finishParticipantAuthentication(db, {
      ceremony,
      credential,
      newCounter: verification.authenticationInfo.newCounter,
      deviceType: verification.authenticationInfo.credentialDeviceType,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      session,
      now,
    })
    return clearCeremonyCookie(setParticipantSessionCookie(privateEmpty(), session.token))
  } catch (error) {
    return clearCeremonyCookie(authenticationVerificationError(error))
  }
}
