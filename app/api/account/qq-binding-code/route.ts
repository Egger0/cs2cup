import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { generateQqBindingCode } from '@/lib/qq-daily-check-in'
import { getAuthContext, IDENTITY_SESSION_COOKIE_NAME } from '@/lib/identity/kernel'

function response(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind === 'anonymous')
      return response({ ok: false, error: '登录已失效，请重新登录。' }, 401)
    const result = await generateQqBindingCode(cloudflareBindings().db, context)
    if (!result.ok) {
      const error =
        result.reason === 'recovery_restricted'
          ? '请先重设密码，再生成 QQ 绑定码。'
          : '登录状态已变化，请刷新后重试。'
      return response({ ok: false, error }, result.reason === 'recovery_restricted' ? 403 : 401)
    }
    return response({ ok: true, code: result.code, expiresAt: result.expiresAt })
  } catch (error) {
    if (error instanceof CsrfError) {
      return response({ ok: false, error: '请求来源无法确认，请刷新页面后重试。' }, 403)
    }
    console.error('[qq-bot] binding-code generation unavailable', error)
    return response({ ok: false, error: '暂时无法生成绑定码，请稍后重试。' }, 503)
  }
}
