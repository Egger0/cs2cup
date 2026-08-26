import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { callFunction, insertRows } from './rdb'

const WINDOW_MINUTES = 60
const MAX_ATTEMPTS = 3

export async function clientFingerprint() {
  const store = await headers()
  const forwarded = store.get('x-forwarded-for') ?? ''
  const address = forwarded.split(',')[0]?.trim() || store.get('x-real-ip') || 'unknown'
  const agent = store.get('user-agent') ?? ''
  return createHash('sha256').update(`${address}|${agent}`).digest('hex').slice(0, 32)
}

export async function recordAttempt(
  fingerprint: string,
  tournamentId: number | null,
  accepted: boolean,
) {
  await insertRows('registration_attempt', {
    fingerprint,
    tournament_id: tournamentId,
    accepted,
  }, { credential: 'admin', revalidate: false }).catch(() => undefined)
}

export async function overRegistrationLimit(fingerprint: string) {
  const count = await callFunction<number>(
    'recent_registration_attempts',
    { p_fingerprint: fingerprint, p_minutes: WINDOW_MINUTES },
    'admin',
  ).catch(() => 0)

  return { blocked: count >= MAX_ATTEMPTS, count, limit: MAX_ATTEMPTS, windowMinutes: WINDOW_MINUTES }
}
