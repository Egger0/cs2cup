import type { NextRequest } from 'next/server'

import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  AuthAttemptRateLimitError,
  beginPasskeySignIn,
  clearCeremonyCookie,
  IdentityPasskeyError,
  setCeremonyCookie,
} from '@/lib/identity/passkeys'
import { passkeyError, privateJson } from '@/lib/passkey-http'

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return passkeyError(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof AuthAttemptRateLimitError) {
    const response = passkeyError(429, '尝试过于频繁，请稍后再试。')
    response.headers.set('Retry-After', String(error.retryAfterSeconds))
    return response
  }
  if (error instanceof IdentityPasskeyError && error.code === 'invalid_request') {
    return passkeyError(400)
  }
  console.error('[identity] passkey sign-in options unavailable')
  return passkeyError(503, '通行密钥服务暂时不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const result = await beginPasskeySignIn({
      headers: request.headers,
      redirectKey: request.nextUrl.searchParams.get('redirectKey'),
      tournamentSlug: request.nextUrl.searchParams.get('tournamentSlug'),
    })
    return setCeremonyCookie(privateJson(result.options), result.ceremonySecret)
  } catch (error) {
    return clearCeremonyCookie(failure(error))
  }
}
