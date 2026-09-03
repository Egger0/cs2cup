import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { createOpaqueToken } from '@/lib/opaque-token'
import { getCurrentParticipant } from '@/lib/participant-auth'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  setCeremonyCookie,
} from '@/lib/passkey-ceremony'
import { passkeyError, privateJson } from '@/lib/passkey-http'
import { participantAuthenticationOptions } from '@/lib/participant-passkeys'
import {
  beginAuthenticationCeremony,
  participantPasskeyRetryAfterSeconds,
} from '@/lib/queries/participant-passkey-challenges'
import { ParticipantPasskeyError } from '@/lib/queries/participant-passkey-shared'
import { clientFingerprint } from '@/lib/ratelimit'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

function authenticationOptionsError(error: unknown, now: number) {
  if (error instanceof CsrfError) return passkeyError(403, '请求来源无法确认，请刷新页面重试。')
  if (error instanceof ParticipantPasskeyError && error.code === 'rate_limited') {
    const response = passkeyError(429, '尝试过于频繁，请稍后再试。')
    response.headers.set('Retry-After', String(participantPasskeyRetryAfterSeconds(now)))
    return response
  }
  return passkeyError(503, '通行密钥服务暂不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  try {
    assertCsrfRequest(request)
    if ((await legacySessionStateFromRequest(request, now)).adminActive) {
      return clearCeremonyCookie(
        passkeyError(409, '旧管理员会话仍在使用，请先安全清除后重新登录。'),
      )
    }
    if (await getCurrentParticipant()) {
      return clearCeremonyCookie(passkeyError(409, '当前赛事通行已打开，请返回继续。'))
    }
    const ceremonyToken = createOpaqueToken()
    const challenge = createOpaqueToken()
    await beginAuthenticationCeremony(cloudflareBindings().db, {
      fingerprint: await clientFingerprint(),
      ceremonyToken,
      challenge,
      previousToken: ceremonyTokenFromRequest(request),
      now,
    })
    const options = await participantAuthenticationOptions({
      config: resolveWebAuthnConfig(),
      challenge,
    })
    return setCeremonyCookie(privateJson(options), ceremonyToken)
  } catch (error) {
    return clearCeremonyCookie(authenticationOptionsError(error, now))
  }
}
