'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { MEMBERSHIP_REWARD_HINT, dailyCheckIn } from '@/lib/stardust'

export async function checkInForStardustAction() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') return { ok: false as const, error: '登录已失效，请重新登录。' }
  if (context.session.recoveryRestricted) {
    return { ok: false as const, error: '请先完成账号恢复，再签到。' }
  }
  const result = await dailyCheckIn(
    cloudflareBindings().db,
    context.account.id,
    currentTimeMillis(),
  )
  if (!result.fresh && !result.reward) {
    return { ok: false as const, error: '今天已经签到过了，明天再来。' }
  }
  revalidatePath('/me')
  return {
    ok: true as const,
    message: result.reward
      ? `签到成功，获得 ${result.reward} 星尘。`
      : `签到成功。${MEMBERSHIP_REWARD_HINT}`,
  }
}
