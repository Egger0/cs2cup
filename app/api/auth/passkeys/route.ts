import type { NextRequest } from 'next/server'

import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  accountPasskeys,
  clearCeremonyCookie,
  IdentityPasskeyError,
  revokePasskey,
} from '@/lib/identity/passkeys'
import {
  clearIdentitySessionCookie,
  getAuthContext,
  IDENTITY_SESSION_COOKIE_NAME,
} from '@/lib/identity/kernel'
import { PasskeyRequestError, passkeyError, privateJson, readPasskeyJson } from '@/lib/passkey-http'

interface RevokeBody {
  credentialId?: unknown
}

function exactCredentialId(value: RevokeBody) {
  if (
    Object.keys(value).some(key => key !== 'credentialId') ||
    typeof value.credentialId !== 'string'
  ) {
    throw new PasskeyRequestError()
  }
  return value.credentialId
}

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return passkeyError(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof PasskeyRequestError) return passkeyError(400)
  if (error instanceof IdentityPasskeyError) {
    if (error.code === 'not_authenticated') return passkeyError(401, '请重新登录后再试。')
    if (error.code === 'recovery_restricted') {
      return passkeyError(403, '请先完成账号恢复，再管理通行密钥。')
    }
    if (error.code === 'reauth_required') {
      return passkeyError(428, '登录确认已超过 15 分钟，请重新登录后移除 Passkey。')
    }
    if (error.code === 'last_credential') {
      return passkeyError(409, '请先完成账号设置或添加另一个 Passkey，再移除这个登录方式。')
    }
    if (error.code === 'not_found') return passkeyError(404, '没有找到这个通行密钥。')
    if (error.code === 'conflict') return passkeyError(409, '安全状态已变化，请刷新后重试。')
    return passkeyError(400)
  }
  console.error('[identity] passkey management unavailable')
  return passkeyError(503, '通行密钥服务暂时不可用，请稍后重试。')
}

async function contextFrom(request: NextRequest, now: number) {
  const context = await getAuthContext({
    token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    now,
  })
  if (context.kind === 'anonymous') throw new IdentityPasskeyError('not_authenticated')
  return context
}

export async function GET(request: NextRequest) {
  try {
    const now = Date.now()
    const passkeys = await accountPasskeys(await contextFrom(request, now), now)
    return privateJson({ passkeys })
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const now = Date.now()
    const [context, credentialId] = await Promise.all([
      contextFrom(request, now),
      readPasskeyJson<RevokeBody>(request).then(exactCredentialId),
    ])
    await revokePasskey(context, credentialId, now)
    return clearCeremonyCookie(
      clearIdentitySessionCookie(privateJson({ ok: true, signedOut: true })),
    )
  } catch (error) {
    return failure(error)
  }
}
