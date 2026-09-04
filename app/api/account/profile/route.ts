import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { updateAccountDisplayName } from '@/lib/identity/account-profile'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const { displayName } = await readIdentityForm(request, ['displayName'] as const)
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind === 'anonymous')
      return json({ ok: false, error: '登录已失效，请重新登录。' }, 401)

    const result = await updateAccountDisplayName(cloudflareBindings().db, context, displayName)
    if (!result.ok) {
      const invalid = result.reason === 'invalid_input'
      return json(
        { ok: false, error: invalid ? '名称应为 1—80 个有效字符。' : '登录已失效，请重新登录。' },
        invalid ? 400 : 401,
      )
    }
    return json({ ok: true, displayName: result.displayName })
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return json({ ok: false, error: '请求无法确认，请刷新页面后重试。' }, 403)
    }
    console.error('[identity] profile update unavailable', error)
    return json({ ok: false, error: '暂时无法保存名称，请稍后重试。' }, 503)
  }
}
