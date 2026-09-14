import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { issueAssistedRecovery } from '@/lib/identity/assisted-recovery'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { getAuthContext, IDENTITY_SESSION_COOKIE_NAME } from '@/lib/identity/kernel'

const FAILURES = {
  invalid_input: [400, '请填写用户名，核实说明至少 10 个字。'],
  reauthentication_required: [428, '请重新验证身份后再签发找回链接。'],
  session_invalid: [401, '登录已失效，请重新登录。'],
  forbidden: [403, '当前账号没有账号找回权限。'],
  not_found: [404, '没有找到这个用户名对应的有效账号。'],
  self_recovery: [409, '不能为自己的账号签发找回链接。'],
  conflict: [409, '账号状态已经变化，请刷新后重试。'],
} as const

function response(status: number, error: string, reauthenticate = false) {
  return withPrivateNoStore(
    NextResponse.json(
      {
        ok: false,
        error,
        reauthenticate,
        redirectTo: reauthenticate ? '/login?redirectKey=workspaces&reauth=1' : undefined,
      },
      { status },
    ),
  )
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, ['username', 'evidence'] as const)
    const context = await getAuthContext({
      token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
    })
    if (context.kind === 'anonymous') return response(401, '请先登录工作台。', true)
    const result = await issueAssistedRecovery(cloudflareBindings().db, context, fields)
    if (!result.ok) {
      const [status, error] = FAILURES[result.reason]
      return response(
        status,
        error,
        result.reason === 'reauthentication_required' || result.reason === 'session_invalid',
      )
    }
    return withPrivateNoStore(
      NextResponse.json({ ok: true, secret: result.secret, expiresAt: result.expiresAt }),
    )
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    console.error('[identity] assisted recovery issue unavailable', error)
    return response(503, '账号找回服务暂时不可用，本次没有签发。')
  }
}
