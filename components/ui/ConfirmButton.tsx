'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import styles from './ConfirmButton.module.css'

const ARMED_MS = 6000

export function ConfirmButton({
  question,
  confirmLabel,
  onConfirm,
  disabled,
  'aria-label': label,
  children,
}: {
  question: string
  confirmLabel: string
  onConfirm: () => void
  disabled?: boolean
  'aria-label'?: string
  children: React.ReactNode
}) {
  const [armed, setArmed] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!armed) return
    confirmRef.current?.focus()
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArmed(false)
    }
    document.addEventListener('keydown', escape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', escape)
    }
  }, [armed])

  if (!armed)
    return (
      <Button
        variant="danger"
        size="mini"
        disabled={disabled}
        aria-label={label}
        onClick={() => setArmed(true)}
      >
        {children}
      </Button>
    )

  return (
    <span className={styles.armed} role="group" aria-label={question}>
      <span className={styles.question} role="status">
        {question}
      </span>
      <Button
        ref={confirmRef}
        variant="danger"
        size="mini"
        disabled={disabled}
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        {confirmLabel}
      </Button>
      <button type="button" className={styles.cancel} onClick={() => setArmed(false)}>
        取消
      </button>
    </span>
  )
}
