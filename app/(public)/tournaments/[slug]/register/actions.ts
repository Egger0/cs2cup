'use server'

import { callFunction } from '@/lib/rdb'
import { clientFingerprint, overRegistrationLimit, recordAttempt } from '@/lib/ratelimit'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  const fingerprint = await clientFingerprint()
  const limit = await overRegistrationLimit(fingerprint)

  if (limit.blocked) {
    return {
      ok: false,
      error: `提交太频繁。每 ${limit.windowMinutes} 分钟最多 ${limit.limit} 次,稍后再试或联系赛事负责人。`,
    }
  }

  const players = [1, 2, 3, 4, 5, 6].map(index => ({
    nickname: String(form.get(`player${index}`) ?? ''),
    substitute: index === 6,
  }))

  const result = await callFunction<RegisterResult>(
    'submit_team',
    {
      payload: {
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

  await recordAttempt(fingerprint, null, result.ok)
  return result
}
