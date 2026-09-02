import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import {
  clearParticipantSessionCookie,
  participantSessionHashFromRequest,
} from '@/lib/participant-auth'
import { privateEmpty, privateJson } from '@/lib/passkey-http'

function sessionError(error: unknown) {
  const status = error instanceof CsrfError ? 403 : 503
  const message =
    status === 403 ? '请求来源无法确认，请刷新页面重试。' : '暂时无法退出赛事通行，请稍后重试。'
  return privateJson({ error: message }, { status })
}

export async function DELETE(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const sessionTokenHash = await participantSessionHashFromRequest(request)
    if (sessionTokenHash) {
      await cloudflareBindings()
        .db.prepare('DELETE FROM participant_session WHERE token_hash = ?')
        .bind(sessionTokenHash)
        .run()
    }
    return clearParticipantSessionCookie(privateEmpty())
  } catch (error) {
    return sessionError(error)
  }
}
