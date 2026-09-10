import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { recruitmentLotteryState } from '@/lib/recruitment-lottery'
import styles from '../admin.module.css'
import { setRecruitmentLotteryManualStateAction } from '../actions/lottery'
import { LotteryClaimForm } from './LotteryClaimForm'

export const dynamic = 'force-dynamic'

export default async function AdminLotteryPage() {
  await requireAdmin()
  const state = await recruitmentLotteryState(cloudflareBindings().db, null, currentTimeMillis())
  const status =
    state.phase === 'open' ? '已开启' : state.phase === 'upcoming' ? '未开始' : '已关闭'

  return (
    <>
      <AdminPageHeader
        index="10"
        title="招新抽奖核销"
        description="让成员出示抽奖结果页，输入 10 位核销码后再发放实物奖品。核销后不能撤销。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>活动状态</h2>
        <p className={styles.messageBody}>
          当前：{status}。临时开启或关闭会覆盖排期；恢复排期后按 9 月 20 日自动开放。
        </p>
        <div className={styles.rowActions}>
          <form action={setRecruitmentLotteryManualStateAction}>
            <input type="hidden" name="state" value="open" />
            <Button type="submit" variant="primary">
              立即开启
            </Button>
          </form>
          <form action={setRecruitmentLotteryManualStateAction}>
            <input type="hidden" name="state" value="closed" />
            <Button type="submit" variant="danger">
              立即关闭
            </Button>
          </form>
          <form action={setRecruitmentLotteryManualStateAction}>
            <input type="hidden" name="state" value="scheduled" />
            <Button type="submit">恢复 9 月 20 日排期</Button>
          </form>
        </div>
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>核销奖品</h2>
        <LotteryClaimForm />
      </section>
    </>
  )
}
