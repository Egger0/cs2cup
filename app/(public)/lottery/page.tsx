import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import QRCode from 'qrcode'
import { PageMasthead, RuleGrid } from '@/components/domain/Sections'
import { ButtonLink } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext } from '@/lib/identity/kernel'
import { recruitmentLotteryState } from '@/lib/recruitment-lottery'
import { LotteryDrawButton } from './LotteryDrawButton'
import styles from './lottery.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '百团大战抽奖',
  robots: { index: false, follow: false, nocache: true },
}

export default async function RecruitmentLotteryPage() {
  const context = await getAuthContext()
  const state = await recruitmentLotteryState(
    cloudflareBindings().db,
    context.kind === 'authenticated' ? context.account.id : null,
    currentTimeMillis(),
  )
  const signedIn = context.kind === 'authenticated' && !context.session.recoveryRestricted
  const receiptQr = state.draw?.receiptCode
    ? await QRCode.toDataURL(`NBTLOTTERY:${state.draw.receiptCode}`, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 360,
      })
    : null

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow="2026 招新 / 9 月 20 日"
            title="百团大战抽奖"
            lede="仅限已审核通过的宁理电竞社成员，每人一次；奖券抽出后不再放回。"
          />
        </div>

        <article className={styles.result} data-rise="2" aria-live="polite">
          {!state.campaign ? (
            <p>抽奖暂未配置。</p>
          ) : state.draw ? (
            <>
              <p className={styles.label}>抽奖结果</p>
              <h2>{state.draw.prizeTitle}</h2>
              {state.draw.receiptCode ? (
                state.draw.claimedAt ? (
                  <p className={styles.notice}>奖品已核销，感谢参与百团大战。</p>
                ) : (
                  <div className={styles.receipt}>
                    <span>摊位兑奖二维码</span>
                    {receiptQr ? (
                      <Image
                        src={receiptQr}
                        alt="用于摊位核销奖品的二维码"
                        width={180}
                        height={180}
                        unoptimized
                      />
                    ) : null}
                    <strong>{state.draw.receiptCode}</strong>
                    <p>请向工作人员出示此二维码；核销成功后即可领取奖品。</p>
                  </div>
                )
              ) : (
                <p className={styles.notice}>感谢参与，祝你在宁理电竞社玩得开心。</p>
              )}
            </>
          ) : state.phase === 'upcoming' ? (
            <>
              <p className={styles.label}>活动尚未开始</p>
              <h2>9 月 20 日见</h2>
              <p className={styles.notice}>活动开放后，本页会显示抽奖按钮。</p>
            </>
          ) : state.phase === 'closed' ? (
            <>
              <p className={styles.label}>活动已结束</p>
              <h2>本次抽奖已经关闭</h2>
              <p className={styles.notice}>感谢参加宁理电竞社百团大战招新活动。</p>
            </>
          ) : !signedIn ? (
            <>
              <p className={styles.label}>需要登录</p>
              <h2>登录后参与抽奖</h2>
              <ButtonLink href="/login?redirectKey=account" variant="primary">
                去登录
              </ButtonLink>
            </>
          ) : !state.eligible ? (
            <>
              <p className={styles.label}>成员资格未通过</p>
              <h2>仅限已审核成员</h2>
              <p className={styles.notice}>请先在账号页提交成员申请，审核通过后即可参与。</p>
              <Link className={styles.textLink} href="/account#membership">
                查看成员资格 →
              </Link>
            </>
          ) : (
            <>
              <p className={styles.label}>资格已确认</p>
              <h2>你的奖券已就绪</h2>
              <p className={styles.notice}>点击后立即揭晓结果，每个成员只能抽取一次。</p>
              <LotteryDrawButton />
            </>
          )}
        </article>

        <div data-rise="3">
          <RuleGrid
            rules={[
              { label: '01', title: '成员限定', body: '仅已审核通过的社团成员可参与。' },
              { label: '02', title: '一人一次', body: '每个账号只能抽取一张奖券。' },
              { label: '03', title: '不放回', body: '每份奖品只会被抽出一次，库存实时减少。' },
            ]}
          />
        </div>
      </div>
    </section>
  )
}
