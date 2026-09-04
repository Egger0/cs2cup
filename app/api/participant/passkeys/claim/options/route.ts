import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { createOpaqueToken } from '@/lib/opaque-token'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  setCeremonyCookie,
} from '@/lib/passkey-ceremony'
import { PasskeyRequestError, passkeyError, privateJson, readPasskeyJson } from '@/lib/passkey-http'
import {
  legacySessionStateFromRequest,
  unifiedSessionStateFromRequest,
} from '@/lib/legacy-session-state'
import { getCurrentParticipant } from '@/lib/participant-auth'
import { participantRegistrationOptions } from '@/lib/participant-passkeys'
import {
  beginClaimCeremony,
  participantPasskeyRetryAfterSeconds,
} from '@/lib/queries/participant-passkey-challenges'
import { ParticipantPasskeyError } from '@/lib/queries/participant-passkey-shared'
import { clientFingerprint } from '@/lib/ratelimit'
import { resolveWebAuthnConfig } from '@/lib/webauthn-config'

interface ClaimOptionsBody {
  slug?: unknown
  token?: unknown
}

function claimOptionsError(error: unknown, now: number) {
  if (error instanceof CsrfError) return passkeyError(403, '请求来源无法确认，请刷新页面重试。')
  if (error instanceof PasskeyRequestError) return passkeyError(400)
  if (error instanceof ParticipantPasskeyError) {
    if (error.code === 'rate_limited') {
      const response = passkeyError(429, '尝试过于频繁，请稍后再试。')
      response.headers.set('Retry-After', String(participantPasskeyRetryAfterSeconds(now)))
      return response
    }
    if (error.code === 'entry_already_claimed') {
      return passkeyError(409, '这份报名已经绑定通行密钥。')
    }
    return passkeyError(404)
  }
  return passkeyError(503, '通行密钥服务暂不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  try {
    assertCsrfRequest(request)
    const [legacySessions, unifiedSession] = await Promise.all([
      legacySessionStateFromRequest(request, now),
      unifiedSessionStateFromRequest(request, now),
    ])
    if (unifiedSession.kind === 'authenticated') {
      return clearCeremonyCookie(
        passkeyError(409, '当前已有统一账号登录，请先退出或完成账号恢复。'),
      )
    }
    if (legacySessions.adminActive) {
      return clearCeremonyCookie(
        passkeyError(409, '旧管理员会话仍在使用，请先安全清除后重新登录。'),
      )
    }
    if (await getCurrentParticipant()) {
      return clearCeremonyCookie(passkeyError(409, '当前已有旧登录状态，请刷新页面后继续关联。'))
    }
    const body = await readPasskeyJson<ClaimOptionsBody>(request)
    const ceremonyToken = createOpaqueToken()
    const challenge = createOpaqueToken()
    const principalId = `p_${createOpaqueToken()}`
    const userHandle = createOpaqueToken()
    const entry = await beginClaimCeremony(cloudflareBindings().db, {
      slug: typeof body.slug === 'string' ? body.slug : '',
      managementToken: typeof body.token === 'string' ? body.token : '',
      fingerprint: await clientFingerprint(),
      ceremonyToken,
      challenge,
      principalId,
      userHandle,
      previousToken: ceremonyTokenFromRequest(request),
      now,
    })
    const config = resolveWebAuthnConfig()
    const options = await participantRegistrationOptions({
      config,
      challenge,
      userHandle,
      accountLabel: `${entry.teamTag} · ${entry.teamName}`,
      displayLabel: `${entry.tournamentTitle} / ${entry.teamTag}`,
    })
    return setCeremonyCookie(privateJson(options), ceremonyToken)
  } catch (error) {
    return clearCeremonyCookie(claimOptionsError(error, now))
  }
}
