'use client'

import { useState, useTransition } from 'react'
import { reportLoadoutCodeAction } from './actions'
import styles from './LoadoutCardActions.module.css'

export function LoadoutReportButton({ id, reported }: { id: number; reported: boolean }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState(reported ? '已反馈失效' : '')
  if (message) {
    return (
      <span className={styles.reported} role="status">
        {message}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={styles.report}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await reportLoadoutCodeAction(id).catch(() => ({
            ok: false as const,
            error: '网络异常，请稍后重试。',
          }))
          setMessage(result.ok ? '已反馈失效，谢谢' : result.error)
        })
      }
    >
      导入失败？反馈
    </button>
  )
}
