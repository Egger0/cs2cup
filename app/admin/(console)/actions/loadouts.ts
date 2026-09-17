'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { reviewLoadoutCode, type LoadoutDecision } from '@/lib/loadout-codes'
import { syncOfficialLoadouts } from '@/lib/loadout-official-sync'
import { discardLoadoutShots, reviewLoadoutShot } from '@/lib/loadout-shots'

const DECISIONS: readonly LoadoutDecision[] = ['approved', 'rejected', 'expired', 'dismiss']

export async function reviewLoadoutCodeAction(id: number, decision: LoadoutDecision) {
  const admin = await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0 || !DECISIONS.includes(decision)) {
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

export async function reviewLoadoutShotAction(id: number, approve: boolean) {
  await requireAdmin()
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false as const, error: '投稿编号无效' }
  const result = await reviewLoadoutShot(cloudflareBindings().db, { id, approve: approve === true })
  if (!result.ok) return { ok: false as const, error: '这张截图已经被处理过了' }
  await discardLoadoutShots(result.stale)
  revalidatePath(`/games/${result.gameSlug}`)
  revalidatePath(`/games/${result.gameSlug}/loadouts`)
  revalidatePath('/admin/loadouts')
  return { ok: true as const }
}

export async function syncOfficialLoadoutsAction() {
  await requireAdmin()
  try {
    const result = await syncOfficialLoadouts(cloudflareBindings().db, fetch, currentTimeMillis())
    revalidatePath('/admin/loadouts')
    if (result.skipped) return { ok: false as const, error: '没有开启改枪码的项目' }
    return {
      ok: true as const,
      message: `同步 ${result.solutions} 套官方方案${result.expired ? `，${result.expired} 套已下架标记失效` : ''}`,
    }
  } catch (error) {
    console.error('[loadouts] official sync failed', error)
    return { ok: false as const, error: '官方接口暂时不可用，稍后再试' }
  }
}
