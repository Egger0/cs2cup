import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cloudflareEnvironment } from './cloudflare-bindings'

export interface AdminIdentity { uid: string }

export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const email = (await headers()).get('cf-access-authenticated-user-email')?.trim().toLowerCase()
  const allowlist = cloudflareEnvironment().CF_ACCESS_ALLOWED_EMAILS
    ?.split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean) ?? []
  if (!email || !allowlist.includes(email)) return null
  return { uid: email }
})

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) notFound()
  return admin
}
