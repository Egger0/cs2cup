'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { clientFingerprint } from '@/lib/ratelimit'

export interface GuestbookResult {
  ok: boolean
  error?: string
}

const FIELD_LIMITS = {
  name: 32,
  body: 500,
} as const

function formText(form: FormData, name: keyof typeof FIELD_LIMITS) {
  const value = String(form.get(name) ?? '').trim()
  if (value.length > FIELD_LIMITS[name]) {
    throw new RangeError(`${name} exceeds its server-side limit`)
  }
  return value
}

export async function submitGuestbookMessage(form: FormData): Promise<GuestbookResult> {
  let name: string
  let body: string
  try {
    name = formText(form, 'name')
    body = formText(form, 'body')
  } catch {
    return { ok: false, error: '留言超出允许长度，请检查后重试' }
  }

  if (!name || !body) return { ok: false, error: '请填写昵称和留言内容' }

  try {
    const fingerprint = await clientFingerprint()
    const { db } = cloudflareBindings()
    await db.batch([
      db.prepare('INSERT INTO guestbook_attempt (fingerprint) VALUES (?)').bind(fingerprint),
      db.prepare("INSERT INTO guestbook_message (name,body,status) VALUES (?,?,'pending')").bind(name, body),
    ])
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('留言太频繁')) {
      return { ok: false, error: '留言太频繁。每 60 分钟最多提交 5 次，请稍后再试。' }
    }
    console.error('[guestbook] guarded submission unavailable', error)
    return { ok: false, error: '留言服务暂时不可用，请稍后再试。' }
  }
}
