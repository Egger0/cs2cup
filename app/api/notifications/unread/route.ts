import { NextResponse } from 'next/server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { withPrivateNoStore } from '@/lib/http-cache'
import { getAuthContext } from '@/lib/identity/kernel'
import { unreadNotificationCount } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const database = cloudflareBindings().db
    const context = await getAuthContext({ database })
    const unread =
      context.kind === 'anonymous' || context.session.recoveryRestricted
        ? 0
        : await unreadNotificationCount(database, context.account.id)
    return withPrivateNoStore(NextResponse.json({ unread }))
  } catch {
    return withPrivateNoStore(NextResponse.json({ unread: 0 }))
  }
}
