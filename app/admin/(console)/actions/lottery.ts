'use server'

import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { claimRecruitmentLotteryPrize } from '@/lib/recruitment-lottery'

export async function claimRecruitmentLotteryPrizeAction(code: string) {
  const admin = await requireAdmin()
  return claimRecruitmentLotteryPrize(
    cloudflareBindings().db,
    admin.accountId,
    code,
    currentTimeMillis(),
  )
}
