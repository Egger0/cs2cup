'use client'

import { type ReactNode, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import type { ContentCreateResult } from './actions/content'
import styles from './admin.module.css'

export function ContentCreateForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  successMessage,
}: {
  action: (formData: FormData) => Promise<ContentCreateResult>
  children: ReactNode
  submitLabel: string
  pendingLabel: string
  successMessage: string
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <form
      ref={formRef}
      className={styles.editor}
      onSubmit={event => {
        event.preventDefault()
        const formData = new FormData(event.currentTarget)
        setFeedback(null)
        startTransition(async () => {
          try {
            const result = await action(formData)
            if (!result.ok) {
              setFeedback({ ok: false, message: result.error })
              return
            }
            formRef.current?.reset()
            setFeedback({ ok: true, message: successMessage })
            router.refresh()
          } catch {
            setFeedback({ ok: false, message: '操作失败，请检查网络后重试。' })
          }
        })
      }}
    >
      {children}
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
