import Link from 'next/link'
import type { StardustWallet as Wallet } from '@/lib/stardust'
import { STARDUST_REWARDS } from '@/lib/stardust'
import { StardustCheckInButton } from './StardustCheckInButton'
import styles from './wallet.module.css'

const STATUS = { open: '待赛果', won: '命中', lost: '未命中', void: '已退回' } as const

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

export function StardustWallet({ wallet }: { wallet: Wallet }) {
  return (
    <section id="stardust-wallet" className={styles.wallet} aria-labelledby="stardust-wallet-title">
      <header className={styles.head}>
        <span className={styles.eyebrow}>STARDUST / 星尘</span>
        <h2 id="stardust-wallet-title">我的星尘</h2>
      </header>
      <div className={styles.summary}>
        <p className={styles.balance}>
          <strong>{wallet.balance}</strong>
          <span>星尘</span>
        </p>
        {wallet.eligible ? (
          <div className={styles.earn}>
            <StardustCheckInButton checkedIn={wallet.checkedInToday} />
            {wallet.matchdayToday ? (
              <p className={styles.matchday}>
                赛事进行中，今日登录奖励 +{STARDUST_REWARDS.matchday} 已到账
              </p>
            ) : null}
          </div>
        ) : (
          <p className={styles.hint}>
            <Link href="/account#membership">成员资格</Link>审核通过后开放签到与赛前预测。
          </p>
        )}
      </div>
      {wallet.predictions.length ? (
        <ol className={styles.ledger} aria-label="最近的预测">
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
                  {entry.status === 'open' ? `应援 ${entry.stake}` : signed(entry.delta)}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : wallet.eligible ? (
        <p className={styles.hint}>
          在比赛详情页的「赛前预测」里为看好的战队应援，赛果出炉后按应援池比例自动结算。
        </p>
      ) : null}
      <p className={styles.note}>
        星尘是社团站内积分，只用于赛前预测这类娱乐玩法，不能充值、兑换或提现。
      </p>
    </section>
  )
}
