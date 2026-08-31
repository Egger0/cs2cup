'use server'

import { updateTag } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import {
  adminCreateOfficialGuestbookReply,
  adminDeleteGuestbookMessage,
  adminSetGuestbookMessagePinned,
  adminSetGuestbookMessageStatus,
} from '@/lib/queries/content'
import type { GuestbookMessageStatus } from '@/lib/types'

export async function setGuestbookMessageStatus(id: number, status: GuestbookMessageStatus) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  if (!['pending', 'published', 'hidden'].includes(status)) {
    return { ok: false as const, error: '留言状态无效' }
  }
  await adminSetGuestbookMessageStatus(id, status)
  updateTag('guestbook')
  return { ok: true as const }
}

export async function setGuestbookMessagePinned(id: number, pinned: boolean) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  try {
    await adminSetGuestbookMessagePinned(id, pinned)
  } catch (error) {
    console.error('[guestbook] pin update failed', error)
    return { ok: false as const, error: '只有主留言可以置顶' }
  }
  updateTag('guestbook')
  return { ok: true as const }
}

export async function createOfficialGuestbookReply(parentId: number, body: string) {
  await requireAdmin()
  const content = body.trim()
  if (!Number.isSafeInteger(parentId) || parentId <= 0) {
    return { ok: false as const, error: '留言编号无效' }
  }
  if (!content || content.length > 500) {
    return { ok: false as const, error: '官方回复需要填写内容，且不能超过 500 个字符' }
  }
  try {
    await adminCreateOfficialGuestbookReply(parentId, content)
  } catch (error) {
    console.error('[guestbook] official reply failed', error)
    return { ok: false as const, error: '官方回复发布失败，请确认原留言仍为公开状态' }
  }
  updateTag('guestbook')
  return { ok: true as const }
}

export async function removeGuestbookMessage(id: number) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '留言编号无效' }
  await adminDeleteGuestbookMessage(id)
  updateTag('guestbook')
  return { ok: true as const }
}
