import { NextResponse, type NextRequest } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { consumeAssistedRecovery } from '@/lib/identity/assisted-recovery'
import { activeAuthFingerprintKey } from '@/lib/identity/internal/auth-fingerprint-config'
import {
  AuthAttemptRateLimitError,
  chargeAuthAttempts,
} from '@/lib/identity/internal/auth-attempts'
import { networkAuthAttemptCharge } from '@/lib/identity/internal/auth-network'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { clientSessionLabel } from '@/lib/identity/internal/session-display'
import { IDENTITY_SESSION_COOKIE_NAME, setIdentitySessionCookie } from '@/lib/identity/kernel'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import { hashOpaqueToken } from '@/lib/opaque-token'
import { clearParticipantSessionCookie } from '@/lib/participant-auth'

function response(status: number, error: string) {
  return withPrivateNoStore(NextResponse.json({ ok: false, error }, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, ['secret'] as const)
    const now = Date.now()
    const network = await networkAuthAttemptCharge(
      request.headers,
      'recovery',
      await activeAuthFingerprintKey(),
      30,
    )
    await chargeAuthAttempts(cloudflareBindings().db, 'recovery', [network], now)
    const currentToken = request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null
    const [currentTokenHash, legacy] = await Promise.all([
      currentToken ? hashOpaqueToken(currentToken) : null,
      legacySessionStateFromRequest(request, now),
    ])
    const result = await consumeAssistedRecovery(
      cloudflareBindings().db,
      { secret: fields.secret, clientLabel: clientSessionLabel(request.headers) },
      now,
      {
        unifiedTokenHash: currentTokenHash,
        legacyAdminTokenHash: legacy.adminTokenHash,
        legacyParticipantTokenHash: legacy.participantTokenHash,
      },
    )
    if (!result.ok) {
      return result.reason === 'invalid_link'
        ? response(401, '找回链接无效、已使用或已过期，请联系管理员重新签发。')
        : response(409, '账号状态已经变化，请刷新页面后重试。')
    }
    const redirect = clearParticipantSessionCookie(
      clearAdminSessionCookie(
        withPrivateNoStore(
          NextResponse.json({ ok: true, redirectTo: '/account/security?recovery=1' }),
        ),
      ),
    )
    return setIdentitySessionCookie(redirect, result.token, result.absoluteExpiresAt, now)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    if (error instanceof AuthAttemptRateLimitError) {
      const result = response(429, '尝试过于频繁，请稍后再试。')
      result.headers.set('Retry-After', String(error.retryAfterSeconds))
      return result
    }
    console.error('[identity] assisted recovery sign-in unavailable', error)
    return response(503, '账号找回暂时不可用，请稍后重试。')
  }
}
