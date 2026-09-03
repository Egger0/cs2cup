import { NextResponse, type NextRequest } from 'next/server'

import { clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import {
  AuthAttemptRateLimitError,
  chargeAuthAttempts,
} from '@/lib/identity/internal/auth-attempts'
import { activeAuthFingerprintKey } from '@/lib/identity/internal/auth-fingerprint-config'
import { createAuthAttemptFingerprint } from '@/lib/identity/internal/auth-fingerprint'
import { networkAuthAttemptCharge } from '@/lib/identity/internal/auth-network'
import {
  IdentityRequestError,
  identityWantsJson,
  readIdentityForm,
} from '@/lib/identity/internal/http'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { normalizeUsername } from '@/lib/identity/internal/username-policy'
import { bootstrapLegacyPlatformOwner } from '@/lib/identity/legacy-owner-bootstrap'
import { getAuthContext, setIdentitySessionCookie } from '@/lib/identity/kernel'
import { legacySessionStateFromRequest } from '@/lib/legacy-session-state'
import { clearParticipantSessionCookie } from '@/lib/participant-auth'
import { resolveSiteOrigin } from '@/lib/site-config'

const FIELDS = ['username', 'displayName', 'password', 'passwordConfirmation'] as const

function failureResponse(request: NextRequest, status: number, code: string, error: string) {
  return withPrivateNoStore(
    identityWantsJson(request)
      ? NextResponse.json({ ok: false, code, error }, { status })
      : NextResponse.redirect(
          new URL(`/admin/bootstrap?error=${encodeURIComponent(code)}`, resolveSiteOrigin()),
          303,
        ),
  )
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const [fields, context, legacy] = await Promise.all([
      readIdentityForm(request, FIELDS),
      getAuthContext({ token: request.cookies.get('__Host-cs2cup_session')?.value ?? null }),
      legacySessionStateFromRequest(request),
    ])
    if (
      context.kind === 'authenticated' ||
      !legacy.adminActive ||
      legacy.participantActive ||
      !legacy.adminTokenHash
    ) {
      return failureResponse(request, 403, 'authority', '旧管理员会话已失效，请重新开始。')
    }

    const fingerprintKey = await activeAuthFingerprintKey()
    const username = normalizeUsername(fields.username) ?? fields.username.trim().toLowerCase()
    const [networkCharge, usernameCharge] = await Promise.all([
      networkAuthAttemptCharge(request.headers, 'enrollment', fingerprintKey, 8),
      createAuthAttemptFingerprint(fingerprintKey, 'enrollment', 'identity', username).then(
        value => ({ dimension: 'identity' as const, ...value, limit: 3 }),
      ),
    ])
    const database = cloudflareBindings().db
    await chargeAuthAttempts(database, 'enrollment', [networkCharge, usernameCharge])
    const result = await bootstrapLegacyPlatformOwner(
      database,
      legacy.adminTokenHash,
      fields,
      await passwordPepperSet(),
      { legacyParticipantTokenHash: legacy.participantTokenHash },
    )
    if (!result.ok) {
      const invalid = result.reason === 'invalid_input'
      const compromised = result.reason === 'password_compromised'
      const completed = result.reason === 'already_completed'
      const conflict =
        completed || result.reason === 'username_unavailable' || result.reason === 'conflict'
      return failureResponse(
        request,
        invalid || compromised
          ? 400
          : conflict
            ? 409
            : result.reason === 'unauthorized'
              ? 403
              : 503,
        result.reason,
        invalid
          ? '请检查用户名、显示名称和密码要求。'
          : compromised
            ? '这个密码曾出现在公开泄露记录中，请换一个只在这里使用的密码。'
            : completed
              ? '管理员账号迁移已经完成，请使用统一登录入口。'
              : conflict
                ? '这个用户名不可用，或迁移状态已经改变，请刷新后重试。'
                : result.reason === 'unauthorized'
                  ? '旧管理员会话已失效，请重新开始。'
                  : '暂时无法完成安全迁移，请稍后重试。',
      )
    }

    const response = withPrivateNoStore(
      identityWantsJson(request)
        ? NextResponse.json({ ok: true, redirectTo: '/admin/identity?welcome=1' })
        : NextResponse.redirect(new URL('/admin/identity?welcome=1', resolveSiteOrigin()), 303),
    )
    clearParticipantSessionCookie(clearAdminSessionCookie(response))
    return setIdentitySessionCookie(response, result.token, result.absoluteExpiresAt)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return failureResponse(request, 403, 'request', '请求来源无法确认，请刷新页面后重试。')
    }
    if (error instanceof AuthAttemptRateLimitError) {
      const response = failureResponse(request, 429, 'rate', '尝试过于频繁，请稍后再试。')
      response.headers.set('Retry-After', String(error.retryAfterSeconds))
      return response
    }
    console.error('[identity] legacy owner bootstrap unavailable', error)
    return failureResponse(request, 503, 'setup', '暂时无法完成安全迁移，请稍后重试。')
  }
}
