'use server'

import { getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { parseCommentBody, parseCommentSubject, postComment, removeComment } from '@/lib/comments'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'

export type CommentResult = { ok: true } | { ok: false; error: string }

async function signedInAccount() {
  const context = await getAuthContext()
  return context.kind === 'anonymous' || context.session.recoveryRestricted
    ? null
    : context.account.id
}

export async function postCommentAction(
  kind: string,
  id: number,
  body: string,
): Promise<CommentResult> {
  const accountId = await signedInAccount()
  if (!accountId) return { ok: false, error: '登录后才能参与。' }
  const subject = parseCommentSubject(kind, id)
  const text = parseCommentBody(body)
  if (!subject) return { ok: false, error: '内容不存在。' }
  if (!text) return { ok: false, error: '留言需为 1–300 个字符。' }
  const result = await postComment(
    cloudflareBindings().db,
    { ...subject, accountId, body: text },
    currentTimeMillis(),
  )
  if (result.ok) return result
  return {
    ok: false,
    error: result.reason === 'limit' ? '留言太频繁了，歇一会儿再来。' : '这里暂时不能留言。',
  }
}

export async function removeCommentAction(commentId: number): Promise<CommentResult> {
  const accountId = await signedInAccount()
  if (!accountId) return { ok: false, error: '登录后才能参与。' }
  if (!Number.isSafeInteger(commentId) || commentId <= 0) return { ok: false, error: '编号无效。' }
  const moderator = Boolean(await getCurrentUnifiedPlatformOwner().catch(() => null))
  const removed = await removeComment(
    cloudflareBindings().db,
    { commentId, accountId, moderator },
    currentTimeMillis(),
  )
  return removed ? { ok: true } : { ok: false, error: '这条留言已经处理过了。' }
}
