'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'

interface State {
  signedIn: boolean
  following: boolean
}

export function FollowPlayer({ handle, followers }: { handle: string; followers: number }) {
  const [state, setState] = useState<State | null>(null)
  const [count, setCount] = useState(followers)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/account/player-follows', { cache: 'no-store' })
      .then(response => response.json() as Promise<{ signedIn: boolean; handles: string[] }>)
      .then(body => {
        if (active) setState({ signedIn: body.signedIn, following: body.handles.includes(handle) })
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [handle])

  async function toggle() {
    if (!state || pending) return
    setPending(true)
    setError('')
    const follow = !state.following
    try {
      const response = await fetch('/api/account/player-follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, follow }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(body?.error ?? '暂时无法保存。')
      setState({ ...state, following: follow })
      setCount(value => Math.max(0, value + (follow ? 1 : -1)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法保存。')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      {state?.signedIn ? (
        <Button
          type="button"
          variant={state.following ? 'ghost' : 'primary'}
          onClick={toggle}
          disabled={pending}
        >
          {state.following ? '已关注' : '关注 TA'}
        </Button>
      ) : state ? (
        <Link href="/login">登录后关注 TA</Link>
      ) : null}
      <p>{count} 位关注者</p>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
