'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { markNotificationsRead } from '@/lib/notifications'

export async function markAllNotificationsReadAction() {
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'anonymous' || context.session.recoveryRestricted) return
  await markNotificationsRead(database, context.account.id, currentTimeMillis())
  revalidatePath('/notifications')
}
