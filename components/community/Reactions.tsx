'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { reactAction } from '@/app/reactions/actions'
import styles from './Reactions.module.css'

const GLYPHS = { fire: '🔥', like: '👍', clap: '👏', heart: '❤️', laugh: '😂' } as const
const NAMES = { fire: '火热', like: '赞', clap: '鼓掌', heart: '喜欢', laugh: '好笑' } as const

type Reaction = keyof typeof GLYPHS
type Counts = Partial<Record<Reaction, number>>

export interface ReactionState {
  counts: Counts
  mine: Reaction | null
}

function apply(state: ReactionState, next: Reaction | null): ReactionState {
  const counts = { ...state.counts }
  if (state.mine) counts[state.mine] = Math.max((counts[state.mine] ?? 1) - 1, 0)
  if (next) counts[next] = (counts[next] ?? 0) + 1
  return { counts, mine: next }
}

export function Reactions({
  kind,
  id,
  initial,
  signedIn: knownSignedIn,
  compact = false,
}: {
  kind: 'post' | 'match' | 'team' | 'comment'
  id: number
  initial?: ReactionState
  signedIn?: boolean
  compact?: boolean
}) {
  const [state, setState] = useState<ReactionState | null>(initial ?? null)
  const [signedIn, setSignedIn] = useState(knownSignedIn ?? false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (initial) return
    let live = true
    fetch(`/api/reactions?kind=${kind}&id=${id}`, { cache: 'no-store' })
      .then(
        response => response.json() as Promise<ReactionState & { ok: boolean; signedIn: boolean }>,
      )
      .then(payload => {
        if (!live || !payload.ok) return
        setState({ counts: payload.counts, mine: payload.mine })
        setSignedIn(payload.signedIn)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [kind, id, initial])

  if (!state) return null

  const choose = (emoji: Reaction) => {
    const previous = state
    const next = previous.mine === emoji ? null : emoji
    setState(apply(previous, next))
    setPicking(false)
    navigator.vibrate?.(6)
    reactAction(kind, id, next)
      .then(ok => (ok ? undefined : setState(previous)))
      .catch(() => setState(previous))
  }

  const shown = (Object.keys(GLYPHS) as Reaction[]).filter(emoji => (state.counts[emoji] ?? 0) > 0)

  return (
    <div className={styles.row} data-compact={compact ? '' : undefined}>
      {shown.map(emoji =>
        signedIn ? (
          <button
            key={emoji}
            type="button"
            className={styles.chip}
            aria-pressed={state.mine === emoji}
            aria-label={`${NAMES[emoji]} ${state.counts[emoji]}`}
            onClick={() => choose(emoji)}
          >
            <span aria-hidden>{GLYPHS[emoji]}</span>
            <b key={state.counts[emoji]}>{state.counts[emoji]}</b>
          </button>
        ) : (
          <span
            key={emoji}
            className={styles.chip}
            aria-label={`${NAMES[emoji]} ${state.counts[emoji]}`}
          >
            <span aria-hidden>{GLYPHS[emoji]}</span>
            <b>{state.counts[emoji]}</b>
          </span>
        ),
      )}
      {signedIn ? (
        <button
          type="button"
          className={styles.add}
          aria-expanded={picking}
          aria-label={picking ? '收起表情' : '添加表情'}
          onClick={() => setPicking(open => !open)}
        >
          <span aria-hidden>{picking ? '×' : '☺+'}</span>
        </button>
      ) : (
        <Link className={styles.add} href="/login" aria-label="登录后添加表情">
          <span aria-hidden>☺+</span>
        </Link>
      )}
      {picking ? (
        <div className={styles.picker} role="group" aria-label="选择表情">
          {(Object.keys(GLYPHS) as Reaction[]).map((emoji, index) => (
            <button
              key={emoji}
              type="button"
              style={{ '--i': index } as React.CSSProperties}
              aria-label={NAMES[emoji]}
              aria-pressed={state.mine === emoji}
              onClick={() => choose(emoji)}
            >
              {GLYPHS[emoji]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
