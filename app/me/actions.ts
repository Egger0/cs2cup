'use server'

import { redirect } from 'next/navigation'
import { endParticipantSession } from '@/lib/participant-auth'

export async function signOut() {
  await endParticipantSession()
  redirect('/')
}
