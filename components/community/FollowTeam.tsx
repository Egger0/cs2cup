'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import styles from './FollowTeam.module.css'

interface State {
  signedIn: boolean
  following: boolean
  followers: number
}

export function FollowTeam({ teamId }: { teamId: number }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    fetch(`/api/account/team-follows?teamId=${teamId}`, { cache: 'no-store' })
      .then(response => response.json() as Promise<State & { ok: boolean }>)
      .then(body => {
        if (live && body.ok) setState(body)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [teamId])

  if (!state) return null

  const toggle = () => {
    const previous = state
    const follow = !previous.following
    setError('')
    setState({ ...previous, following: follow, followers: previous.followers + (follow ? 1 : -1) })
    navigator.vibrate?.(8)
    fetch('/api/account/team-follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId, follow }),
    })
      .then(async response => {
        if (response.ok) return
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? '暂时无法保存。')
      })
      .catch(caught => {
        setState(previous)
        setError(caught instanceof Error ? caught.message : '暂时无法保存。')
      })
  }

  return (
    <div className={styles.follow}>
      {state.signedIn ? (
        <Button
          type="button"
          size="mini"
          variant={state.following ? 'ghost' : 'primary'}
          aria-pressed={state.following}
          onClick={toggle}
        >
          {state.following ? '已关注' : '关注队伍'}
        </Button>
      ) : (
        <Link href="/login">登录后关注队伍</Link>
      )}
      <span>{state.followers} 人关注</span>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
