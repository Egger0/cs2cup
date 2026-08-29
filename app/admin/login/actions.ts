'use server'

import { redirect } from 'next/navigation'
import { credentialsAccepted, startAdminSession } from '@/lib/auth'

export async function signIn(form: FormData) {
  const username = String(form.get('username') ?? '').trim()
  const password = String(form.get('password') ?? '')
  if (!await credentialsAccepted(username, password)) redirect('/admin/login?error=1')
  await startAdminSession(username)
  redirect('/admin')
}
