'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { reviewLoadoutCode } from '@/lib/loadout-codes'

export async function reviewLoadoutCodeAction(id: number, decision: 'approved' | 'rejected') {
  const admin = await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0 || !['approved', 'rejected'].includes(decision)) {
    return { ok: false as const, error: '投稿编号或审核决定无效' }
  }
  const result = await reviewLoadoutCode(
    cloudflareBindings().db,
    { id, reviewerAccountId: admin.accountId, decision },
    currentTimeMillis(),
  )
  if (!result.ok) return { ok: false as const, error: '这条投稿已经被处理过了' }
  revalidatePath(`/games/${result.gameSlug}`)
  revalidatePath(`/games/${result.gameSlug}/loadouts`)
  revalidatePath('/admin/loadouts')
  return { ok: true as const }
}
