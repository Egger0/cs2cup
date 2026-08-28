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

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  const players = [1, 2, 3, 4, 5, 6].map(index => ({
    nickname: String(form.get(`player${index}`) ?? ''),
    substitute: index === 6,
  }))

  try {
    const fingerprint = await clientFingerprint()
    return await callFunction<RegisterResult>(
      'submit_team_rate_limited',
      {
        p_fingerprint: fingerprint,
        p_payload: {
          slug,
          name: String(form.get('name') ?? ''),
          tag: String(form.get('tag') ?? ''),
          captain: String(form.get('captain') ?? ''),
          contact: String(form.get('contact') ?? ''),
          dept: String(form.get('dept') ?? ''),
          note: String(form.get('note') ?? ''),
          players,
        },
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
