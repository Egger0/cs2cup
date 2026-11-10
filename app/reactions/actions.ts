'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { parseReaction, parseReactionSubject, setReaction } from '@/lib/reactions'

export async function reactAction(kind: string, id: number, emoji: string | null) {
  const context = await getAuthContext()
  if (context.kind === 'anonymous' || context.session.recoveryRestricted) return false
  const subject = parseReactionSubject(kind, id)
  const reaction = emoji === null ? null : parseReaction(emoji)
  if (!subject || (emoji !== null && !reaction)) return false
  return setReaction(
    cloudflareBindings().db,
    { ...subject, accountId: context.account.id, emoji: reaction },
    currentTimeMillis(),
  )
}
