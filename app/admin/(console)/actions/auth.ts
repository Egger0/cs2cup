'use server'

import { redirect } from 'next/navigation'
import { endAdminSession } from '@/lib/auth'

export async function signOut() {
  await endAdminSession()
  redirect('/')
}
