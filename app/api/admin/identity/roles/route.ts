import { NextResponse, type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { withPrivateNoStore } from '@/lib/http-cache'
import { IdentityRequestError, readIdentityForm } from '@/lib/identity/internal/http'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  grantManagedRole,
  MANAGED_IDENTITY_ROLES,
  revokeManagedRole,
  type ManagedIdentityRole,
} from '@/lib/identity/role-management'

const FIELDS = [
  'operation',
  'username',
  'role',
  'tournamentId',
  'assignmentId',
  'revision',
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

function failure(reason: string) {
  if (reason === 'reauthentication_required') {
    return response(428, '请重新验证身份后再管理权限。', true)
  }
  if (reason === 'session_invalid') return response(401, '登录已失效，请重新登录。', true)
  if (reason === 'forbidden') return response(403, '当前账号没有人员权限管理能力。')
  if (reason === 'not_found') return response(404, '没有找到对应账号或权限记录。')
  if (reason === 'conflict') return response(409, '权限已经变化，请刷新后重试。')
  return response(400, '请检查账号和操作说明。')
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const fields = await readIdentityForm(request, FIELDS)
    const context = await getAuthContext({
      token: request.cookies.get('__Host-cs2cup_session')?.value ?? null,
    })
    if (context.kind === 'anonymous') return response(401, '请先登录工作台。', true)
    const database = cloudflareBindings().db
    if (fields.operation === 'grant') {
      const tournamentId = fields.tournamentId ? Number(fields.tournamentId) : null
      if (
        !MANAGED_IDENTITY_ROLES.includes(fields.role as ManagedIdentityRole) ||
        (fields.tournamentId !== '' && !/^\d{1,10}$/.test(fields.tournamentId))
      ) {
        return response(400, '请选择有效角色和赛事。')
      }
      const result = await grantManagedRole(database, context, {
        username: fields.username,
        role: fields.role as ManagedIdentityRole,
        tournamentId,
        reason: fields.reason,
      })
      return result.ok
        ? withPrivateNoStore(NextResponse.json({ ok: true, assignmentId: result.assignmentId }))
        : failure(result.reason)
    }
    if (fields.operation !== 'revoke' || !/^\d{1,10}$/.test(fields.revision)) {
      return response(400, '不支持的权限操作。')
    }
    const result = await revokeManagedRole(database, context, {
      assignmentId: fields.assignmentId,
      revision: Number(fields.revision),
      reason: fields.reason,
    })
    return result.ok ? withPrivateNoStore(NextResponse.json({ ok: true })) : failure(result.reason)
  } catch (error) {
    if (error instanceof CsrfError || error instanceof IdentityRequestError) {
      return response(403, '请求来源无法确认，请刷新页面后重试。')
    }
    console.error('[identity] reviewer role operation unavailable', error)
    return response(503, '权限服务暂时不可用，本次操作没有完成。')
  }
}
