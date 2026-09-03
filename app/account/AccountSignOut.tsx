'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function AccountSignOut() {
  const router = useRouter()
  const [working, setWorking] = useState(false)

  async function signOut() {
    if (working) return
    setWorking(true)
    try {
      const response = await fetch('/api/auth/session', {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error('sign out failed')
      router.replace('/')
      router.refresh()
    } catch {
      setWorking(false)
    }
  }

  return (
    <button type="button" disabled={working} onClick={() => void signOut()}>
      {working ? '正在退出…' : '退出'}
    </button>
  )
}
