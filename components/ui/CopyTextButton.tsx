'use client'

import { useId, useState, type ReactNode } from 'react'
import styles from './CopyTextButton.module.css'

export function CopyTextButton({
  value,
  label,
  className,
  children,
}: {
  value: string
  label: string
  className?: string
  children?: ReactNode
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const hintId = useId()

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setStatus('copied')
    } catch {
      setStatus('manual')
    }
  }

  return (
    <span className={styles.control}>
      <button
        type="button"
        className={className}
        aria-label={children ? label : undefined}
        onClick={copy}
        aria-describedby={hintId}
      >
        {children ?? label}
      </button>
      <span id={hintId} className={styles.feedback} role="status">
        {status === 'copied'
          ? '已复制'
          : status === 'manual'
            ? '未能自动复制，请选中下方内容复制。'
            : ''}
      </span>
      {status === 'manual' ? (
        <input
          aria-label={`${label}：手动复制`}
          value={value}
          readOnly
          onFocus={event => event.currentTarget.select()}
        />
      ) : null}
    </span>
  )
}
