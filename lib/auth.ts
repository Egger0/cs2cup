import 'server-only'
import { cookies } from 'next/headers'
import { verifyToken } from './jwt'
import { selectRow } from './rdb'

export const SESSION_COOKIE = 'cs2cup_session'

export { verifyToken }

export interface AdminIdentity {
  uid: string
}

async function isWhitelisted(uid: string) {
  const row = await selectRow<{ user_id: string }>('admin_user', {
    select: 'user_id',
    filters: { user_id: `eq.${uid}` },
    credential: 'admin',
    revalidate: false,
  })
  return row !== null
}

export async function getCurrentAdmin(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const claims = await verifyToken(token)
  if (!claims) return null
  if (!(await isWhitelisted(claims.sub))) return null

  return { uid: claims.sub }
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) throw new Error('unauthorized')
  return admin
}
