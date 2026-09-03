'use server'

import { redirect } from 'next/navigation'
import { endLegacySessions } from '@/lib/auth'

export async function signOut() {
  await endLegacySessions()
  redirect('/')
}
