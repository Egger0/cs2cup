import Image from 'next/image'
import Link from 'next/link'
import type { LotteryReceipt } from './receipt'
import styles from './lottery.module.css'

export function LotteryResult({ receipt }: { receipt: LotteryReceipt }) {
  if (!receipt.receiptCode) {
    return (
      <div className={styles.outcome} data-outcome="thanks">
        <p className={styles.label}>本次结果</p>
        <h2 className={styles.prizeName} tabIndex={-1}>
          谢谢参与
        </h2>
        <p className={styles.notice}>
          这张奖券没中。社里的{' '}
          <Link className={styles.textLink} href="/maps">
            战术沙盘
          </Link>{' '}
          和{' '}
          <Link className={styles.textLink} href="/loadouts">
            改枪码
          </Link>{' '}
          随时能用，摊位也随时欢迎你来坐。
        </p>
      </div>
    )
  }

  if (receipt.claimed) {
    return (
      <div className={styles.outcome} data-outcome="claimed">
        <p className={styles.label}>已核销</p>
        <h2 className={styles.prizeName} tabIndex={-1}>
          {receipt.prizeTitle}
        </h2>
        <p className={styles.notice}>奖品已经领走，感谢参与百团大战。</p>
      </div>
    )
  }

  return (
    <div className={styles.outcome} data-outcome="won">
      <p className={styles.label}>你抽到了</p>
      <h2 className={styles.prizeName} tabIndex={-1}>
        {receipt.prizeTitle}
      </h2>
      <div className={styles.receipt}>
        <span>摊位兑奖二维码</span>
        {receipt.receiptQr ? (
          <Image
            src={receipt.receiptQr}
            alt="用于摊位核销奖品的二维码"
            width={180}
            height={180}
            unoptimized
          />
        ) : null}
        <strong>{receipt.receiptCode}</strong>
        <p>向工作人员出示这个二维码，核销后当场领奖。</p>
      </div>
    </div>
  )
}
