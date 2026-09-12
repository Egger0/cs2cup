'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmButton } from '@/components/ui'
import { removeTournament } from '../actions/tournaments'
import styles from '../admin.module.css'

export function TournamentDeleteButton({ id, title }: { id: number; title: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)

  return (
    <>
      <ConfirmButton
        question={`删除「${title}」？报名、对阵和图片也会一并删除，不可撤销。`}
        confirmLabel="删除"
        disabled={pending}
        onConfirm={() => {
          startTransition(async () => {
            setFeedback(null)
            try {
              const result = await removeTournament(id)
              if (!result.ok) {
                setFeedback({ tone: 'error', message: result.error })
                return
              }

              setFeedback({
                tone: result.warning ? 'warning' : 'success',
                message: result.warning ?? '赛事已删除',
              })
              if (result.warning) window.alert(result.warning)
              router.refresh()
            } catch {
              setFeedback({ tone: 'error', message: '删除失败，请检查网络后重试。' })
            }
          })
        }}
      >
        {pending ? '删除中…' : '删除'}
      </ConfirmButton>
      {feedback ? (
        <span
          className={feedback.tone === 'success' ? styles.ok : styles.error}
          role={feedback.tone === 'success' ? 'status' : 'alert'}
        >
          {feedback.message}
        </span>
      ) : null}
    </>
  )
}
