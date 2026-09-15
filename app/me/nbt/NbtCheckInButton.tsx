'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { checkInForNbtAction } from './actions'
import styles from './wallet.module.css'

export function NbtCheckInButton({ checkedIn }: { checkedIn: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <div className={styles.checkIn}>
      <button
        type="button"
        className={styles.checkInButton}
        disabled={checkedIn || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await checkInForNbtAction().catch(() => ({
              ok: false as const,
              error: '网络异常，请稍后重试。',
            }))
            setFeedback(
              result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error },
            )
            if (result.ok) router.refresh()
          })
        }
      >
        {checkedIn ? '今日已签到' : pending ? '签到中…' : '每日签到 +10'}
      </button>
      <p
        className={feedback && !feedback.ok ? styles.error : styles.hint}
        role={feedback?.ok === false ? 'alert' : 'status'}
      >
        {feedback?.text ?? '在 QQ 群里发送「签到」同样有效，每天一次。'}
      </p>
    </div>
  )
}
