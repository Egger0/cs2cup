'use server'

import { callFunction } from '@/lib/rdb'

export interface RegisterResult {
  ok: boolean
  error?: string
  seatsLeft?: number
}

export async function registerTeam(slug: string, form: FormData): Promise<RegisterResult> {
  const players = [1, 2, 3, 4, 5, 6].map(index => ({
    nickname: String(form.get(`player${index}`) ?? ''),
    substitute: index === 6,
  }))

  return callFunction<RegisterResult>('submit_team', {
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
  })
}
