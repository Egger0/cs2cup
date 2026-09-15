'use server'

import { revalidatePath } from 'next/cache'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { checkInForStardust } from '@/lib/stardust'

export async function checkInForStardustAction() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') return { ok: false as const, error: '登录已失效，请重新登录。' }
  if (context.session.recoveryRestricted) {
    return { ok: false as const, error: '请先完成账号恢复，再签到。' }
  }
  const result = await checkInForStardust(
    cloudflareBindings().db,
    context.account.id,
    currentTimeMillis(),
  )
  if (result.ok) {
    revalidatePath('/me')
    return { ok: true as const, message: `签到成功，获得 ${result.reward} 星尘。` }
  }
  return {
    ok: false as const,
    error:
      result.reason === 'already_checked_in'
        ? '今天已经签到过了，明天再来。'
        : '成员资格审核通过后才能签到领取星尘。',
  }
}
