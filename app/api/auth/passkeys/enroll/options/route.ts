import type { NextRequest } from 'next/server'

import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  AuthAttemptRateLimitError,
  beginPasskeyEnrollment,
  clearCeremonyCookie,
  IdentityPasskeyError,
  setCeremonyCookie,
} from '@/lib/identity/passkeys'
import { getAuthContext, IDENTITY_SESSION_COOKIE_NAME } from '@/lib/identity/kernel'
import { PasskeyRequestError, passkeyError, privateJson, readPasskeyJson } from '@/lib/passkey-http'

interface OptionsBody {
  label?: unknown
}

function exactBody(value: OptionsBody) {
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'label')) throw new PasskeyRequestError()
  return value
}

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return passkeyError(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof PasskeyRequestError) return passkeyError(400)
  if (error instanceof AuthAttemptRateLimitError) {
    const response = passkeyError(429, '尝试过于频繁，请稍后再试。')
    response.headers.set('Retry-After', String(error.retryAfterSeconds))
    return response
  }
  if (error instanceof IdentityPasskeyError) {
    if (error.code === 'not_authenticated') return passkeyError(401, '请重新登录后再试。')
    if (error.code === 'recovery_restricted') {
      return passkeyError(403, '请先完成账号恢复，再添加通行密钥。')
    }
    return passkeyError(400)
  }
  console.error('[identity] passkey enrollment options unavailable')
  return passkeyError(503, '通行密钥服务暂时不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  try {
    assertCsrfRequest(request)
    const body = exactBody(await readPasskeyJson<OptionsBody>(request))
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
      now,
    })
    if (context.kind === 'anonymous') throw new IdentityPasskeyError('not_authenticated')
    const result = await beginPasskeyEnrollment({
      context,
      headers: request.headers,
      label: body.label,
      now,
    })
    return setCeremonyCookie(privateJson(result.options), result.ceremonySecret)
  } catch (error) {
    return clearCeremonyCookie(failure(error))
  }
}
