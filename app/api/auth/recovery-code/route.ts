import { NextResponse, type NextRequest } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { activeAuthFingerprintKey } from '@/lib/identity/internal/auth-fingerprint-config'
import { createAuthAttemptFingerprint } from '@/lib/identity/internal/auth-fingerprint'
import {
  AuthAttemptRateLimitError,
  chargeAuthAttempts,
} from '@/lib/identity/internal/auth-attempts'
import { networkAuthAttemptCharge } from '@/lib/identity/internal/auth-network'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { consumeRecoveryCode } from '@/lib/identity/internal/recovery-code-consumption'
import { RecoveryCodeError } from '@/lib/identity/internal/recovery-code-shared'
import { clientSessionLabel } from '@/lib/identity/internal/session-display'
import { IDENTITY_SESSION_COOKIE_NAME, setIdentitySessionCookie } from '@/lib/identity/kernel'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import { hashOpaqueToken } from '@/lib/opaque-token'
import { clearParticipantSessionCookie } from '@/lib/participant-auth'

const FIELDS = ['username', 'code'] as const

function response(status: number, error: string) {
  return withPrivateNoStore(NextResponse.json({ ok: false, error }, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, FIELDS)
    const now = Date.now()
    const fingerprintKey = await activeAuthFingerprintKey()
    const [network, identity] = await Promise.all([
      networkAuthAttemptCharge(request.headers, 'recovery_code', fingerprintKey, 30),
      createAuthAttemptFingerprint(
        fingerprintKey,
        'recovery_code',
        'identity',
        fields.username.trim().toLowerCase(),
      ).then(value => ({ dimension: 'identity' as const, ...value, limit: 10 })),
    ])
    await chargeAuthAttempts(cloudflareBindings().db, 'recovery_code', [network, identity], now)
    const currentToken = request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null
    const [currentTokenHash, legacy] = await Promise.all([
      currentToken ? hashOpaqueToken(currentToken) : null,
      legacySessionStateFromRequest(request, now),
    ])
    const result = await consumeRecoveryCode(
      cloudflareBindings().db,
      { ...fields, clientLabel: clientSessionLabel(request.headers) },
      await passwordPepperSet(),
      now,
      {
        unifiedTokenHash: currentTokenHash,
        legacyAdminTokenHash: legacy.adminTokenHash,
        legacyParticipantTokenHash: legacy.participantTokenHash,
      },
    )
    const response = clearParticipantSessionCookie(
      clearAdminSessionCookie(
        withPrivateNoStore(
          NextResponse.json({ ok: true, redirectTo: '/account/security?recovery=1' }),
        ),
      ),
    )
    return setIdentitySessionCookie(response, result.token, result.absoluteExpiresAt, now)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    if (error instanceof AuthAttemptRateLimitError) {
      const result = response(429, '尝试过于频繁，请稍后再试。')
      result.headers.set('Retry-After', String(error.retryAfterSeconds))
      return result
    }
    if (error instanceof RecoveryCodeError) {
      if (error.code === 'invalid_input' || error.code === 'invalid_code') {
        return response(401, '用户名或恢复码不正确。')
      }
      if (error.code === 'conflict') return response(409, '恢复码状态已经变化，请换一枚再试。')
    }
    console.error('[identity] recovery-code sign-in unavailable', error)
    return response(503, '账号恢复暂时不可用，请稍后重试。')
  }
}
