'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

export function PublicHandleForm({ handle }: { handle: string | null }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function save(value: string) {
    if (working) return
    setWorking(true)
    setError('')
    const body = new URLSearchParams()
    body.append('handle', value)
    try {
      const response = await fetch('/api/account/public-handle', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error ?? '暂时无法保存主页地址。')
      setEditing(false)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法保存主页地址。')
    } finally {
      setWorking(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = new FormData(event.currentTarget).get('handle')
    await save(typeof value === 'string' ? value : '')
  }

  if (!editing) {
    return (
      <>
        <p>
          {handle
            ? `你的参赛记录公开在 /players/${handle}`
            : '还没有公开主页。设定一个地址后，你的参赛记录才会公开。'}
        </p>
        <button type="button" onClick={() => setEditing(true)}>
          {handle ? '修改主页地址' : '公开我的参赛记录'}
        </button>
        {handle ? (
          <button
            type="button"
            disabled={working}
            onClick={() => {
              if (confirm('取消公开后，这个地址会失效，别人将看不到你的参赛记录。')) void save('')
            }}
          >
            取消公开
          </button>
        ) : null}
      </>
    )
  }

  return (
    <form onSubmit={submit}>
      <label>
        <span>主页地址</span>
        <input
          name="handle"
          defaultValue={handle ?? ''}
          maxLength={30}
          placeholder="例如 aster"
          autoComplete="off"
          autoFocus
        />
      </label>
      <p>公开的只有参赛记录，不含联系方式，也不含用于登录的用户名。</p>
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
