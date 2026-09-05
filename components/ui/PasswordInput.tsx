'use client'

import { useId, useState, type InputHTMLAttributes } from 'react'
import styles from './PasswordInput.module.css'

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  const id = props.id ?? generatedId
  return (
    <span className={styles.control}>
      <input {...props} id={id} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        aria-label={visible ? '隐藏密码' : '显示密码'}
        aria-pressed={visible}
        aria-controls={id}
        disabled={props.disabled}
        onClick={() => setVisible(value => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="m3 3 18 18" /> : null}
        </svg>
      </button>
    </span>
  )
}
