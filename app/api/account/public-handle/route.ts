import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { setPublicHandle } from '@/lib/identity/public-handle'

const REFUSAL = {
  invalid: '主页地址只能用 3—30 个小写字母、数字或连字符，且不能以连字符开头或结尾。',
  reserved: '这个地址被站点保留，请换一个。',
  taken: '这个地址已经有人使用。',
  session_invalid: '登录已失效，请重新登录。',
} as const

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const { handle } = await readIdentityForm(request, ['handle'] as const)
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind === 'anonymous')
      return json({ ok: false, error: '登录已失效，请重新登录。' }, 401)

    const result = await setPublicHandle(
      cloudflareBindings().db,
      context,
      handle.trim() === '' ? null : handle,
    )
    if (!result.ok) {
      return json(
        { ok: false, error: REFUSAL[result.reason] },
        result.reason === 'session_invalid' ? 401 : 400,
      )
    }
    return json({ ok: true, handle: result.handle })
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return json({ ok: false, error: '请求无法确认，请刷新页面后重试。' }, 403)
    }
    console.error('[identity] public handle update unavailable', error)
    return json({ ok: false, error: '暂时无法保存主页地址，请稍后重试。' }, 503)
  }
}
