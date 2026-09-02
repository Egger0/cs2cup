import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { createOpaqueToken } from '@/lib/opaque-token'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  setCeremonyCookie,
} from '@/lib/passkey-ceremony'
import { passkeyError, privateJson } from '@/lib/passkey-http'
import { participantAuthenticationOptions } from '@/lib/participant-passkeys'
import { beginAuthenticationCeremony } from '@/lib/queries/participant-passkey-challenges'
import { ParticipantPasskeyError } from '@/lib/queries/participant-passkey-shared'
import { clientFingerprint } from '@/lib/ratelimit'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

function authenticationOptionsError(error: unknown) {
  if (error instanceof CsrfError) return passkeyError(403, '请求来源无法确认，请刷新页面重试。')
  if (error instanceof ParticipantPasskeyError && error.code === 'rate_limited') {
    return passkeyError(429, '尝试过于频繁，请稍后再试。')
  }
  return passkeyError(503, '通行密钥服务暂不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const ceremonyToken = createOpaqueToken()
    const challenge = createOpaqueToken()
    await beginAuthenticationCeremony(cloudflareBindings().db, {
      fingerprint: await clientFingerprint(),
      ceremonyToken,
      challenge,
      previousToken: ceremonyTokenFromRequest(request),
      now: Date.now(),
    })
    const options = await participantAuthenticationOptions({
      config: resolveWebAuthnConfig(),
      challenge,
    })
    return setCeremonyCookie(privateJson(options), ceremonyToken)
  } catch (error) {
    return clearCeremonyCookie(authenticationOptionsError(error))
  }
}
