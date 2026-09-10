'use server'

import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import {
  claimRecruitmentLotteryPrize,
  RECRUITMENT_LOTTERY_CAMPAIGN_ID,
} from '@/lib/recruitment-lottery'
import { revalidatePath } from 'next/cache'

export async function claimRecruitmentLotteryPrizeAction(code: string) {
  const admin = await requireAdmin()
  return claimRecruitmentLotteryPrize(
    cloudflareBindings().db,
    admin.accountId,
    code,
    currentTimeMillis(),
  )
}

export async function setRecruitmentLotteryManualStateAction(formData: FormData) {
  await requireAdmin()
  const state = formData.get('state')
  const manualState = state === 'open' || state === 'closed' ? state : null
  if (state !== 'open' && state !== 'closed' && state !== 'scheduled') return

  await cloudflareBindings()
    .db.prepare('UPDATE recruitment_lottery_campaign SET manual_state = ? WHERE id = ?')
    .bind(manualState, RECRUITMENT_LOTTERY_CAMPAIGN_ID)
    .run()
  revalidatePath('/lottery')
  revalidatePath('/admin/lottery')
}
