'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { drawRecruitmentLottery } from '@/lib/recruitment-lottery'

export async function drawRecruitmentLotteryAction() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') return { ok: false as const, error: '请先登录后再参与抽奖。' }
  if (context.session.recoveryRestricted) {
    return { ok: false as const, error: '请先完成账号恢复，再参与抽奖。' }
  }
  const result = await drawRecruitmentLottery(
    cloudflareBindings().db,
    context.account.id,
    currentTimeMillis(),
  )
  if (result.ok) revalidatePath('/lottery')
  return result
}
