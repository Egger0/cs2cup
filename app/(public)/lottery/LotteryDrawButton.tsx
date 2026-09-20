'use client'

import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { Button } from '@/components/ui'
import { drawRecruitmentLotteryAction } from './actions'
import { LotteryResult } from './LotteryResult'
import type { LotteryReceipt } from './receipt'
import styles from './lottery.module.css'

const REEL_LENGTH = 9

function reelItems(titles: string[], landed: string) {
  const pool = titles.filter(title => title !== landed)
  const spun = Array.from(
    { length: REEL_LENGTH - 1 },
    () => pool[Math.floor(Math.random() * pool.length)] ?? landed,
  )
  return [...spun, landed]
}

export function LotteryDrawButton({ prizeTitles }: { prizeTitles: string[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<LotteryReceipt | null>(null)
  const [reel, setReel] = useState<string[] | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reel) return
    box.current?.querySelector<HTMLElement>('h2')?.focus()
  }, [receipt, reel])

  if (reel) {
    return (
      <div className={styles.ready}>
        <p className={styles.label}>正在开奖</p>
        <div className={styles.reel} aria-hidden="true">
          <ol
            style={{ '--stop': reel.length - 1 } as CSSProperties}
            onAnimationEnd={() => setReel(null)}
          >
            {reel.map((title, index) => (
              <li key={index} className={styles.prizeName}>
                {title}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  if (receipt) {
    return (
      <div ref={box} className={styles.landed}>
        <LotteryResult receipt={receipt} />
      </div>
    )
  }

  return (
    <div className={styles.ready}>
      <p className={styles.label}>资格已确认</p>
      <h2>你的奖券已就绪</h2>
      <p className={styles.notice}>点击后立即揭晓结果，每个成员只能抽取一次。</p>
      <div>
        <Button
          type="button"
          variant="primary"
          disabled={pending}
          onClick={() => {
            setError(null)
            startTransition(async () => {
              const result = await drawRecruitmentLotteryAction().catch(() => ({
                ok: false as const,
                error: '网络不稳，请再抽一次。',
              }))
              if (!result.ok) {
                setError(result.error)
                return
              }
              setReceipt(result.receipt)
              if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                setReel(reelItems(prizeTitles, result.receipt.prizeTitle))
              }
            })
          }}
        >
          {pending ? '抽取中…' : '抽取我的奖券'}
        </Button>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </div>
  )
}
