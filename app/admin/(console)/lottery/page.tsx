import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import styles from '../admin.module.css'
import { LotteryClaimForm } from './LotteryClaimForm'

export const dynamic = 'force-dynamic'

export default async function AdminLotteryPage() {
  await requireAdmin()

  return (
    <>
      <AdminPageHeader
        index="10"
        title="招新抽奖核销"
        description="让成员出示抽奖结果页，输入 10 位核销码后再发放实物奖品。核销后不能撤销。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>核销奖品</h2>
        <LotteryClaimForm />
      </section>
    </>
  )
}
