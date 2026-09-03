import type { NextRequest } from 'next/server'

import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  IdentityPasskeyError,
  verifyPasskeyEnrollment,
  type RegistrationResponseJSON,
} from '@/lib/identity/passkeys'
import { getAuthContext, IDENTITY_SESSION_COOKIE_NAME } from '@/lib/identity/kernel'
import { PasskeyRequestError, passkeyError, privateJson, readPasskeyJson } from '@/lib/passkey-http'

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return passkeyError(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof PasskeyRequestError) return passkeyError(400)
  if (error instanceof IdentityPasskeyError) {
    if (error.code === 'not_authenticated') return passkeyError(401, '请重新登录后再试。')
    if (error.code === 'recovery_restricted') {
      return passkeyError(403, '请先完成账号恢复，再添加通行密钥。')
    }
    if (error.code === 'conflict') return passkeyError(409, '这个通行密钥已经存在，请刷新后重试。')
    return passkeyError(400)
  }
  console.error('[identity] passkey enrollment verification unavailable')
  return passkeyError(503, '通行密钥服务暂时不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  try {
    assertCsrfRequest(request)
    const ceremonySecret = ceremonyTokenFromRequest(request)
    if (!ceremonySecret) throw new IdentityPasskeyError('invalid_ceremony')
    const [response, context] = await Promise.all([
      readPasskeyJson<RegistrationResponseJSON>(request),
      getAuthContext({
        token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
        now,
      }),
    ])
    if (context.kind === 'anonymous') throw new IdentityPasskeyError('not_authenticated')
    const passkey = await verifyPasskeyEnrollment({
      context,
      ceremonySecret,
      response,
      now,
    })
    return clearCeremonyCookie(privateJson({ ok: true, passkey }, { status: 201 }))
  } catch (error) {
    return clearCeremonyCookie(failure(error))
  }
}
