'use server'

import { callFunction } from '@/lib/rdb'
import { clientFingerprint } from '@/lib/ratelimit'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
  code?: 'RATE_LIMITED' | 'SUBMISSION_FAILED'
  retryAfterSeconds?: number
}

const FIELD_LIMITS = {
  name: 20,
  tag: 5,
  captain: 20,
  contact: 40,
  dept: 30,
  note: 120,
  player: 20,
} as const

function formText(form: FormData, name: string, maxLength: number) {
  const value = String(form.get(name) ?? '').trim()
  if (value.length > maxLength) throw new RangeError(`${name} exceeds its server-side limit`)
  return value
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) {
    return { ok: false, error: '当前赛事不存在或不可报名' }
  }

  let payload: Record<string, unknown>
  try {
    payload = {
      slug,
      name: formText(form, 'name', FIELD_LIMITS.name),
      tag: formText(form, 'tag', FIELD_LIMITS.tag),
      captain: formText(form, 'captain', FIELD_LIMITS.captain),
      contact: formText(form, 'contact', FIELD_LIMITS.contact),
      dept: formText(form, 'dept', FIELD_LIMITS.dept),
      note: formText(form, 'note', FIELD_LIMITS.note),
      players: [1, 2, 3, 4, 5, 6].map(index => ({
        nickname: formText(form, `player${index}`, FIELD_LIMITS.player),
        substitute: index === 6,
      })),
    }
  } catch {
    return { ok: false, error: '报名信息超出允许长度，请检查后重试' }
  }

  try {
    const fingerprint = await clientFingerprint()
    return await callFunction<RegisterResult>(
      'submit_team_rate_limited',
      {
        p_fingerprint: fingerprint,
        p_payload: payload,
      },
      'admin',
    )
  } catch (error) {
    console.error('[registration] guarded submission unavailable', error)

    return {
      ok: false,
      code: 'SUBMISSION_FAILED',
      error: '报名服务暂时不可用，请稍后再试；如问题持续，请联系赛事负责人。',
    }
  }
}
