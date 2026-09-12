'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import styles from './ConfirmButton.module.css'

const ARMED_MS = 10_000

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
  children: ReactNode
}) {
  const [armed, setArmed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const restore = useRef(false)

  const dismiss = () => {
    restore.current = true
    setArmed(false)
  }

  useEffect(() => {
    if (!armed) {
      if (!restore.current) return
      restore.current = false
      triggerRef.current?.focus()
      return
    }
    confirmRef.current?.focus()
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss()
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
        ref={triggerRef}
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
      <button type="button" className={styles.cancel} onClick={dismiss}>
        取消
      </button>
    </span>
  )
}
