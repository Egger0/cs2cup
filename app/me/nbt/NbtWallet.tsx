import Link from 'next/link'
import type { NbtWallet as Wallet } from '@/lib/nbt'
import { NBT_REWARDS } from '@/lib/nbt'
import { NbtCheckInButton } from './NbtCheckInButton'
import styles from './wallet.module.css'

const STATUS = { open: '待开奖', won: '猜中', lost: '未猜中', void: '已退回' } as const

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

export function NbtWallet({ wallet }: { wallet: Wallet }) {
  return (
    <section id="nbt-wallet" className={styles.wallet} aria-labelledby="nbt-wallet-title">
      <header className={styles.head}>
        <span className={styles.eyebrow}>NBT WALLET / 竞猜积分</span>
        <h2 id="nbt-wallet-title">我的 nbt</h2>
      </header>
      <div className={styles.summary}>
        <p className={styles.balance}>
          <strong>{wallet.balance}</strong>
          <span>nbt</span>
        </p>
        {wallet.eligible ? (
          <div className={styles.earn}>
            <NbtCheckInButton checkedIn={wallet.checkedInToday} />
            {wallet.matchdayToday ? (
              <p className={styles.matchday}>
                赛事进行中，今日登录奖励 +{NBT_REWARDS.matchday} 已到账
              </p>
            ) : null}
          </div>
        ) : (
          <p className={styles.hint}>
            <Link href="/account#membership">成员资格</Link>审核通过后开放签到与赛前竞猜。
          </p>
        )}
      </div>
      {wallet.predictions.length ? (
        <ol className={styles.ledger} aria-label="最近的竞猜">
          {wallet.predictions.map(entry => (
            <li key={entry.matchId}>
              <Link
                href={`/tournaments/${encodeURIComponent(entry.tournamentSlug)}/matches/${entry.matchId}`}
              >
                <span className={styles.match}>
                  {entry.tournamentTitle} · {entry.roundLabel}
                </span>
                <strong>支持 {entry.teamName}</strong>
                <span className={styles.status} data-status={entry.status}>
                  {STATUS[entry.status]}
                </span>
                <span className={styles.delta}>
                  {entry.status === 'open' ? `投入 ${entry.stake}` : signed(entry.delta)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : wallet.eligible ? (
        <p className={styles.hint}>
          在比赛详情页的「赛前竞猜」里投入 nbt，开奖后按奖池比例自动结算。
        </p>
      ) : null}
      <p className={styles.note}>nbt 是社团站内积分，只用于竞猜娱乐，不能充值、兑换或提现。</p>
    </section>
  )
}
