'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export function BioForm({ bio }: { bio: string | null }) {
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
    body.append('bio', String(new FormData(event.currentTarget).get('bio') ?? ''))
    try {
      const response = await fetch('/api/account/bio', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? '暂时无法保存。')
      setEditing(false)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法保存。')
    } finally {
      setWorking(false)
    }
  }

  if (!editing) {
    return (
      <>
        <p>{bio ?? '还没有个性签名。写一句话，会显示在你的公开主页上。'}</p>
        <button type="button" onClick={() => setEditing(true)}>
          {bio ? '修改签名' : '写个性签名'}
        </button>
      </>
    )
  }

  return (
    <form onSubmit={submit}>
      <label>
        <span>个性签名</span>
        <input name="bio" defaultValue={bio ?? ''} maxLength={120} autoFocus autoComplete="off" />
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
