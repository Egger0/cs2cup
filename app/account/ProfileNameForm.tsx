'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export function ProfileNameForm({ displayName }: { displayName: string }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError('')
    const body = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string') body.append(key, value)
    }
    try {
      const response = await fetch('/api/account/profile', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? '暂时无法保存名称。')
      setEditing(false)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法保存名称。')
    } finally {
      setWorking(false)
    }
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}>
        修改显示名称
      </button>
    )
  }

  return (
    <form onSubmit={submit}>
      <label>
        <span>显示名称</span>
        <input name="displayName" defaultValue={displayName} maxLength={80} required autoFocus />
      </label>
      {error ? <span role="alert">{error}</span> : null}
      <div>
        <button type="submit" disabled={working}>
          {working ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={working} onClick={() => setEditing(false)}>
          取消
        </button>
      </div>
    </form>
  )
}
