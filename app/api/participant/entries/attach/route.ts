import { type NextRequest } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { assertCsrfRequest, CsrfError } from '@/lib/csrf'
import { exactParticipantEntryAttachmentBody } from '@/lib/participant-entry-attachment-request'
import {
  legacySessionStateFromRequest,
  unifiedSessionStateFromRequest,
} from '@/lib/legacy-session-state'
import {
  clearParticipantSessionCookie,
  participantSessionHashFromRequest,
} from '@/lib/participant-auth'
import { PasskeyRequestError, privateEmpty, privateJson, readPasskeyJson } from '@/lib/passkey-http'
import {
  attachParticipantEntry,
  ParticipantEntryAttachmentError,
} from '@/lib/queries/participant-entry-attachment'

function errorResponse(status: number, message: string) {
  return privateJson({ error: message }, { status })
}

function attachmentError(error: unknown) {
  if (error instanceof CsrfError) {
    return errorResponse(403, '请求来源无法确认，请刷新页面重试。')
  }
  if (error instanceof PasskeyRequestError) {
    return errorResponse(400, '请求内容不正确，请刷新页面重试。')
  }
  if (error instanceof ParticipantEntryAttachmentError) {
    if (error.code === 'invalid_session') {
      return clearParticipantSessionCookie(errorResponse(401, '旧登录状态已失效，请重新登录。'))
    }
    if (error.code === 'invalid_entry') {
      return errorResponse(404, '找不到可加入的赛事报名。')
    }
    if (error.code === 'entry_owned_elsewhere') {
      return errorResponse(409, '这份报名已经关联到另一个账号。')
    }
  }
  return errorResponse(503, '旧登录方式暂不可用，请稍后重试。')
}

export async function POST(request: NextRequest) {
  try {
    assertCsrfRequest(request)
    const [legacySessions, unifiedSession] = await Promise.all([
      legacySessionStateFromRequest(request),
      unifiedSessionStateFromRequest(request),
    ])
    if (unifiedSession.kind === 'authenticated') {
      return errorResponse(409, '当前已有统一账号登录，请先退出或完成账号恢复。')
    }
    if (legacySessions.adminActive) {
      return errorResponse(409, '旧管理员会话仍在使用，请先安全清除后重新登录。')
    }
    const sessionTokenHash = await participantSessionHashFromRequest(request)
    if (!sessionTokenHash) throw new ParticipantEntryAttachmentError('invalid_session')

    const body = exactParticipantEntryAttachmentBody(await readPasskeyJson<unknown>(request))
    if (!body) throw new PasskeyRequestError()

    await attachParticipantEntry(cloudflareBindings().db, {
      sessionTokenHash,
      slug: body.slug,
      managementToken: body.managementToken,
      now: Date.now(),
    })
    return privateEmpty()
  } catch (error) {
    return attachmentError(error)
  }
}
