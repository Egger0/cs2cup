import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { passwordPepperSet } from '@/lib/identity/internal/password-config'
import { RecoveryCodeError } from '@/lib/identity/internal/recovery-code-shared'
import { generateRecoveryCodes, recoveryCodeSummary } from '@/lib/identity/internal/recovery-codes'
import { getAuthContext, IDENTITY_SESSION_COOKIE_NAME } from '@/lib/identity/kernel'

function response(status: number, error: string, reauthenticate = false) {
  return withPrivateNoStore(
    NextResponse.json(
      {
        ok: false,
        error,
        reauthenticate,
        redirectTo: reauthenticate ? '/login?redirectKey=account_security&reauth=1' : undefined,
      },
      { status },
    ),
  )
}

async function contextFrom(request: NextRequest) {
  const context = await getAuthContext({
    token: request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null,
  })
  if (context.kind === 'anonymous') throw new RecoveryCodeError('not_authenticated')
  return context
}

function failure(error: unknown) {
  if (error instanceof CsrfError) {
    return response(403, '请求来源无法确认，请刷新页面后重试。')
  }
  if (error instanceof RecoveryCodeError) {
    if (error.code === 'not_authenticated') return response(401, '登录已失效，请重新登录。', true)
    if (error.code === 'reauth_required') {
      return response(428, '登录确认已超过 15 分钟，请重新登录后生成恢复码。', true)
    }
    if (error.code === 'recovery_restricted') {
      return response(403, '请先重设密码，再管理恢复码。')
    }
    if (error.code === 'account_setup_required') {
      return response(409, '请先完成账号设置，再生成恢复码。')
    }
    return response(409, '安全状态已经变化，请刷新后重试。')
  }
  console.error('[identity] recovery-code management unavailable', error)
  return response(503, '暂时无法管理恢复码。')
}

export async function GET(request: NextRequest) {
  try {
    const summary = await recoveryCodeSummary(cloudflareBindings().db, await contextFrom(request))
    return withPrivateNoStore(NextResponse.json(summary))
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const codes = await generateRecoveryCodes(
      cloudflareBindings().db,
      await contextFrom(request),
      await passwordPepperSet(),
    )
    return withPrivateNoStore(NextResponse.json({ ok: true, codes }))
  } catch (error) {
    return failure(error)
  }
}
