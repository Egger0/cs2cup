import type { NextRequest } from 'next/server'

import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  ceremonyTokenFromRequest,
  clearCeremonyCookie,
  clearPasskeyLegacyCookies,
  IdentityPasskeyError,
  passkeySessionReplacement,
  verifyPasskeySignIn,
  type AuthenticationResponseJSON,
} from '@/lib/identity/passkeys'
import { setIdentitySessionCookie } from '@/lib/identity/kernel'
import { PasskeyRequestError, passkeyError, privateJson, readPasskeyJson } from '@/lib/passkey-http'

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return passkeyError(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof PasskeyRequestError) return passkeyError(400)
  if (error instanceof IdentityPasskeyError) return passkeyError(400)
  console.error('[identity] passkey sign-in verification unavailable')
  return passkeyError(503, '通行密钥服务暂时不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  try {
    assertCsrfRequest(request)
    const ceremonySecret = ceremonyTokenFromRequest(request)
    if (!ceremonySecret) throw new IdentityPasskeyError('invalid_ceremony')
    const [response, replacement] = await Promise.all([
      readPasskeyJson<AuthenticationResponseJSON>(request),
      passkeySessionReplacement(request),
    ])
    const result = await verifyPasskeySignIn({
      ceremonySecret,
      response,
      replacement,
      headers: request.headers,
      now,
    })
    const success = privateJson({ ok: true, redirectTo: result.redirectTo })
    success.headers.set('X-Identity-Next', result.redirectTo)
    return clearPasskeyLegacyCookies(
      clearCeremonyCookie(
        setIdentitySessionCookie(success, result.token, result.absoluteExpiresAt, now),
      ),
    )
  } catch (error) {
    return clearCeremonyCookie(failure(error))
  }
}
