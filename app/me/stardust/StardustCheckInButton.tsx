'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { checkInForStardustAction } from './actions'
import styles from './wallet.module.css'

export function StardustCheckInButton({ checkedIn }: { checkedIn: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <div className={styles.checkIn}>
      <Button
        type="button"
        variant={checkedIn ? 'ghost' : 'primary'}
        disabled={checkedIn || pending}
        onClick={() =>
          startTransition(async () => {
            const result = await checkInForStardustAction().catch(() => ({
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
      </Button>
      <p
        className={feedback && !feedback.ok ? styles.error : styles.hint}
        role={feedback?.ok === false ? 'alert' : 'status'}
      >
        {feedback?.text ?? '在 QQ 群里发送「签到」同样有效，每天一次。'}
      </p>
    </div>
  )
}
