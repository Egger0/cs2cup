import { type NextRequest } from 'next/server'

import { adminSessionCookie, clearAdminSessionCookie } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { hashOpaqueToken } from '@/lib/opaque-token'
import {
  clearParticipantSessionCookie,
  participantSessionHashFromRequest,
} from '@/lib/participant-auth'
import { privateEmpty, privateJson } from '@/lib/passkey-http'

function sessionError(error: unknown) {
  const status = error instanceof CsrfError ? 403 : 503
  const message =
    status === 403 ? '请求来源无法确认，请刷新页面重试。' : '暂时无法退出旧登录状态，请稍后重试。'
  return privateJson({ error: message }, { status })
}

export async function DELETE(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const adminToken = request.cookies.get(adminSessionCookie.name)?.value
    const [participantTokenHash, adminTokenHash] = await Promise.all([
      participantSessionHashFromRequest(request),
      adminToken ? hashOpaqueToken(adminToken) : null,
    ])
    const db = cloudflareBindings().db
    const deletions = []
    if (participantTokenHash) {
      deletions.push(
        db
          .prepare('DELETE FROM participant_session WHERE token_hash = ?')
          .bind(participantTokenHash),
      )
    }
    if (adminTokenHash) {
      deletions.push(
        db.prepare('DELETE FROM admin_session WHERE token_hash = ?').bind(adminTokenHash),
      )
    }
    if (deletions.length > 0) await db.batch(deletions)
    return clearAdminSessionCookie(clearParticipantSessionCookie(privateEmpty()))
  } catch (error) {
    return sessionError(error)
  }
}
