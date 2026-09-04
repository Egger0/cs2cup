import { NextResponse, type NextRequest } from 'next/server'

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
import { IdentityRequestError, readIdentityJson } from '@/lib/identity/internal/http'
import { changeAccountPassword } from '@/lib/identity/internal/password-change'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import {
  getAuthContext,
  IDENTITY_SESSION_COOKIE_NAME,
  setIdentitySessionCookie,
} from '@/lib/identity/kernel'

interface PasswordBody extends Record<string, unknown> {
  currentPassword?: unknown
  password?: unknown
  passwordConfirmation?: unknown
}

function response(status: number, error: string, code?: string) {
  return withPrivateNoStore(NextResponse.json({ ok: false, error, code }, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const [body, context] = await Promise.all([
      readIdentityJson<PasswordBody>(request),
      getAuthContext({
        token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
      }),
    ])
    if (
      Object.keys(body).some(
        key => !['currentPassword', 'password', 'passwordConfirmation'].includes(key),
      ) ||
      context.kind === 'anonymous'
    ) {
      return response(context.kind === 'anonymous' ? 401 : 400, '请重新登录后再修改密码。')
    }
    const now = Date.now()
    const fingerprintKey = await activeAuthFingerprintKey()
    const [network, account] = await Promise.all([
      networkAuthAttemptCharge(request.headers, 'sensitive_confirmation', fingerprintKey, 30),
      createAuthAttemptFingerprint(
        fingerprintKey,
        'sensitive_confirmation',
        'account',
        context.account.id,
      ).then(value => ({ dimension: 'account' as const, ...value, limit: 10 })),
    ])
    await chargeAuthAttempts(
      cloudflareBindings().db,
      'sensitive_confirmation',
      [network, account],
      now,
    )
    const result = await changeAccountPassword(
      cloudflareBindings().db,
      context,
      {
        currentPassword: body.currentPassword,
        password: body.password,
        passwordConfirmation: body.passwordConfirmation,
      },
      await passwordPepperSet(),
      { now },
    )
    if (!result.ok) {
      if (result.reason === 'not_authenticated') return response(401, '登录已失效，请重新登录。')
      if (result.reason === 'invalid_current_password') {
        return response(401, '当前密码不正确。', result.reason)
      }
      if (result.reason === 'temporarily_locked') {
        return response(429, '尝试次数较多，请 15 分钟后再试。', result.reason)
      }
      if (result.reason === 'password_reused') {
        return response(400, '新密码不能与当前密码相同。', result.reason)
      }
      if (result.reason === 'password_context') {
        return response(400, '新密码不能包含用户名、显示名称或本站名称。', result.reason)
      }
      if (result.reason === 'password_compromised') {
        return response(400, '这个密码曾出现在泄露数据中，请换一个。', result.reason)
      }
      if (result.reason === 'screening_unavailable') {
        return response(503, '暂时无法安全检查新密码，本次没有修改。', result.reason)
      }
      if (result.reason === 'unsupported_recovery') {
        return response(403, '这个恢复会话不能修改密码。', result.reason)
      }
      if (result.reason === 'configuration_unavailable') {
        return response(503, '密码服务配置暂时不可用。', result.reason)
      }
      if (result.reason === 'conflict') {
        return response(409, '安全状态已经变化，请刷新后重试。', result.reason)
      }
      return response(400, '请确认新密码至少 6 个字符，并与确认密码一致。', result.reason)
    }
    return setIdentitySessionCookie(
      withPrivateNoStore(NextResponse.json({ ok: true })),
      result.token,
      result.absoluteExpiresAt,
      now,
    )
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    if (error instanceof AuthAttemptRateLimitError) {
      const result = response(429, '尝试过于频繁，请稍后再试。')
      result.headers.set('Retry-After', String(error.retryAfterSeconds))
      return result
    }
    console.error('[identity] password change unavailable', error)
    return response(503, '密码服务暂时不可用，本次没有修改。')
  }
}
