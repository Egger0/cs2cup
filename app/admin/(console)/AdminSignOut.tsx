'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import styles from './shell.module.css'

export function AdminSignOut() {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

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
      setError('退出失败，请重试')
      setWorking(false)
    }
  }

  return (
    <div className={styles.signOut}>
      <Button type="button" size="mini" disabled={working} onClick={() => void signOut()}>
        {working ? '正在退出…' : '退出'}
      </Button>
      {error ? (
        <span className={styles.signOutError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
