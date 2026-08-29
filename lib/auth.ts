import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { verifyAccessRequest } from './cloudflare-access'

export interface AdminIdentity {
  uid: string
  email?: string
}

const authenticateAdmin = cache(async (): Promise<AdminIdentity | null> =>
  verifyAccessRequest(await headers()),
)

export function getCurrentAdmin() {
  return authenticateAdmin()
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) notFound()
  return admin
}
