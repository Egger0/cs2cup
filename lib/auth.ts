import 'server-only'
import { cookies } from 'next/headers'
import { verifyToken } from './jwt'
import { selectRows } from './rdb'

export const SESSION_COOKIE = 'cs2cup_session'

export { verifyToken }

export interface AdminIdentity {
  uid: string
}

async function isWhitelisted(uid: string) {
  const rows = await selectRows<{ user_id: string }>('admin_user', {
    select: 'user_id',
    credential: 'admin',
    revalidate: false,
  })
  return rows.some(row => row.user_id === uid)
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
