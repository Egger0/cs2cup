'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import styles from './AccountSignOut.module.css'

export function AccountSignOut() {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const errorId = useId()

  async function signOut() {
    if (working) return
    setWorking(true)
    setError('')
    try {
      const response = await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('sign out failed')
      router.replace('/')
      router.refresh()
    } catch {
      setError('退出暂未完成，请检查网络后重试。')
      setWorking(false)
    }
  }

  return (
    <span className={styles.control}>
      <button
        type="button"
        disabled={working}
        aria-describedby={error ? errorId : undefined}
        onClick={() => void signOut()}
      >
        {working ? '正在退出…' : '退出'}
      </button>
      {error ? (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
