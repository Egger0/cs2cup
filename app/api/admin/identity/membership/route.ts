import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  claimMembershipApplication,
  reviewMembershipApplication,
} from '@/lib/identity/membership-service'

const FIELDS = [
  'operation',
  'applicationId',
  'revision',
  'submissionVersion',
  'submissionDigest',
  'decision',
  'reason',
] as const

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

function integer(value: string) {
  return /^\d{1,10}$/.test(value) ? Number(value) : null
}

function serviceFailure(reason: string) {
  if (reason === 'reauthentication_required') {
    return response(428, '请重新验证身份后再执行审核操作。', true)
  }
  if (reason === 'session_invalid') return response(401, '登录已失效，请重新登录。', true)
  if (reason === 'forbidden') return response(403, '当前账号没有成员资格审核权限。')
  if (reason === 'invalid_input') return response(400, '请检查审核决定和说明。')
  if (reason === 'not_found') return response(404, '申请不存在或已被处理。')
  if (reason === 'conflict') return response(409, '申请已被其他审核员更新，请刷新队列。')
  return response(409, '当前申请状态不支持这个操作。')
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, FIELDS)
    const context = await getAuthContext({
      token: request.cookies.get('__Host-cs2cup_session')?.value ?? null,
    })
    if (context.kind === 'anonymous') return response(401, '请先登录工作台。', true)
    const revision = integer(fields.revision)
    if (revision === null) return response(400, '申请版本无效。')
    const database = cloudflareBindings().db

    if (fields.operation === 'claim') {
      const result = await claimMembershipApplication(database, context, {
        applicationId: fields.applicationId,
        revision,
      })
      return result.ok
        ? withPrivateNoStore(NextResponse.json({ ok: true, application: result.application }))
        : serviceFailure(result.reason)
    }
    if (fields.operation !== 'review') return response(400, '不支持的审核操作。')
    const submissionVersion = integer(fields.submissionVersion)
    if (
      submissionVersion === null ||
      !['approved', 'changes_requested', 'rejected'].includes(fields.decision)
    ) {
      return response(400, '审核提交内容无效。')
    }
    const result = await reviewMembershipApplication(database, context, {
      applicationId: fields.applicationId,
      revision,
      submissionVersion,
      submissionDigest: fields.submissionDigest,
      decision: fields.decision as 'approved' | 'changes_requested' | 'rejected',
      reason: fields.reason,
    })
    return result.ok
      ? withPrivateNoStore(
          NextResponse.json({
            ok: true,
            application: result.application,
            membershipId: result.membershipId,
          }),
        )
      : serviceFailure(result.reason)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    console.error('[identity] membership review unavailable', error)
    return response(503, '审核服务暂时不可用，本次操作没有完成。')
  }
}
