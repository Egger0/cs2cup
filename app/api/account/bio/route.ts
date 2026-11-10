import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { currentTimeMillis } from '@/lib/current-time'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { IDENTITY_SESSION_COOKIE_NAME, getAuthContext } from '@/lib/identity/kernel'
import { parseBio, setBio } from '@/lib/player-social'

function json(body: object, status = 200) {
  return withPrivateNoStore(NextResponse.json(body, { status }))
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const { bio } = await readIdentityForm(request, ['bio'] as const)
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind === 'anonymous' || context.session.recoveryRestricted) {
      return json({ ok: false, error: '登录已失效，请重新登录。' }, 401)
    }
    const parsed = parseBio(bio)
    if (!parsed) return json({ ok: false, error: '个性签名最多 120 个字符。' }, 400)
    await setBio(cloudflareBindings().db, context.account.id, parsed.bio, currentTimeMillis())
    return json({ ok: true, bio: parsed.bio })
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return json({ ok: false, error: '请求无法确认，请刷新页面后重试。' }, 403)
    }
    return json({ ok: false, error: '暂时无法保存，请稍后重试。' }, 503)
  }
}
