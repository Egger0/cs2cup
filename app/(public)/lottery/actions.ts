'use server'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { drawRecruitmentLottery, recruitmentLotteryState } from '@/lib/recruitment-lottery'
import { lotteryReceipt, type LotteryReceipt } from './receipt'

export async function drawRecruitmentLotteryAction(): Promise<
  { ok: true; receipt: LotteryReceipt } | { ok: false; error: string }
> {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') return { ok: false, error: '请先登录后再参与抽奖。' }
  if (context.session.recoveryRestricted) {
    return { ok: false, error: '请先完成账号恢复，再参与抽奖。' }
  }
  const database = cloudflareBindings().db
  const now = currentTimeMillis()
  const result = await drawRecruitmentLottery(database, context.account.id, now)
  if (!result.ok) return result

  const receipt = await lotteryReceipt(
    (await recruitmentLotteryState(database, context.account.id, now)).draw,
  )
  if (!receipt) return { ok: false, error: '没有读到抽奖结果，请刷新页面。' }
  return { ok: true, receipt }
}
