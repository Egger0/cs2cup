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
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { completePasskeyAccountSetup } from '@/lib/identity/passkey-account-setup'
import {
  getAuthContext,
  IDENTITY_SESSION_COOKIE_NAME,
  type AuthenticatedAuthContext,
} from '@/lib/identity/kernel'

interface SetupBody extends Record<string, unknown> {
  username?: unknown
  password?: unknown
  passwordConfirmation?: unknown
}

function response(status: number, error: string, code: string, field?: string) {
  return withPrivateNoStore(NextResponse.json({ ok: false, error, code, field }, { status }))
}

function failure(
  result: Exclude<Awaited<ReturnType<typeof completePasskeyAccountSetup>>, { ok: true }>,
) {
  if (result.reason === 'not_authenticated') {
    return response(401, '登录已失效，请重新登录。', result.reason)
  }
  if (result.reason === 'recovery_restricted') {
    return response(403, '请先完成账号恢复。', result.reason)
  }
  if (result.reason === 'passkey_required') {
    return response(403, '请使用 Passkey 重新登录后完成设置。', result.reason)
  }
  if (result.reason === 'reauth_required') {
    return response(428, '登录确认已超过 15 分钟，请使用 Passkey 重新登录。', result.reason)
  }
  if (result.reason === 'not_eligible') {
    return response(403, '当前账号不需要这项设置。', result.reason)
  }
  if (result.reason === 'already_configured') {
    return response(409, '账号已经完成设置，请刷新页面。', result.reason)
  }
  if (result.reason === 'username_unavailable') {
    return response(409, '这个用户名不可用，请换一个再试。', result.reason, 'username')
  }
  if (result.reason === 'password_context') {
    return response(400, '密码不应包含用户名、显示名称或本站名称。', result.reason, 'password')
  }
  if (result.reason === 'password_compromised') {
    return response(400, '这个密码曾出现在泄露记录中，请换一个。', result.reason, 'password')
  }
  if (result.reason === 'screening_unavailable') {
    return response(503, '暂时无法安全检查新密码，本次没有保存。', result.reason, 'password')
  }
  if (result.reason === 'conflict') {
    return response(409, '安全状态已经变化，请刷新后重试。', result.reason)
  }
  const message =
    result.field === 'username'
      ? '用户名需为 3–32 位小写字母、数字、点、短横线或下划线。'
      : result.field === 'passwordConfirmation'
        ? '两次输入的密码不一致。'
        : '密码至少需要 6 个字符。'
  return response(400, message, result.reason, result.field)
}

async function charge(request: NextRequest, context: AuthenticatedAuthContext, now: number) {
  const key = await activeAuthFingerprintKey()
  const [network, account] = await Promise.all([
    networkAuthAttemptCharge(request.headers, 'sensitive_confirmation', key, 20),
    createAuthAttemptFingerprint(key, 'sensitive_confirmation', 'account', context.account.id).then(
      value => ({ dimension: 'account' as const, ...value, limit: 8 }),
    ),
  ])
  await chargeAuthAttempts(
    cloudflareBindings().db,
    'sensitive_confirmation',
    [network, account],
    now,
  )
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const now = Date.now()
    const [body, context] = await Promise.all([
      readIdentityJson<SetupBody>(request),
      getAuthContext({
        token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
        now,
      }),
    ])
    if (context.kind === 'anonymous') {
      return response(401, '登录已失效，请重新登录。', 'not_authenticated')
    }
    if (
      Object.keys(body).some(key => !['username', 'password', 'passwordConfirmation'].includes(key))
    ) {
      return response(400, '提交内容无法识别。', 'invalid_input')
    }
    await charge(request, context, now)
    const result = await completePasskeyAccountSetup(
      cloudflareBindings().db,
      context,
      {
        username: body.username,
        password: body.password,
        passwordConfirmation: body.passwordConfirmation,
      },
      await passwordPepperSet(),
      { now },
    )
    return result.ok
      ? withPrivateNoStore(NextResponse.json({ ok: true, username: result.username }))
      : failure(result)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。', 'request')
    }
    if (error instanceof AuthAttemptRateLimitError) {
      const result = response(429, '尝试过于频繁，请稍后再试。', 'rate')
      result.headers.set('Retry-After', String(error.retryAfterSeconds))
      return result
    }
    console.error('[identity] initial account setup unavailable', error)
    return response(503, '账号设置服务暂时不可用，本次没有保存。', 'unavailable')
  }
}
