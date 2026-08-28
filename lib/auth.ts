import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from './jwt'
import { selectPrivateRows } from './rdb'

export const SESSION_COOKIE = 'cs2cup_session'

export { verifyToken }

export interface AdminIdentity {
  uid: string
}

async function isWhitelisted(uid: string) {
  const rows = await selectPrivateRows<{ user_id: string }>('admin_user', {
    select: 'user_id',
    filters: { user_id: `eq.${uid}` },
    limit: 1,
  })
  return rows[0]?.user_id === uid
}

export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const claims = await verifyToken(token)
  if (!claims) return null
  if (!(await isWhitelisted(claims.sub))) return null

  return { uid: claims.sub }
})

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login')
  return admin
}
