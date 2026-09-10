'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'

import { Button } from '@/components/ui'
import { assignRosterSeat } from './actions'
import styles from './registration-access.module.css'

export interface RosterSeat {
  readonly playerId: number
  readonly nickname: string
  readonly isSubstitute: boolean
  readonly holder: string | null
}

export function RosterSeatPanel({ teamId, seats }: { teamId: number; seats: RosterSeat[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  if (seats.length === 0) return null

  const submit = (event: FormEvent<HTMLFormElement>, playerId: number) => {
    event.preventDefault()
    const username = new FormData(event.currentTarget).get('username')
    if (typeof username !== 'string' || !username.trim()) {
      setFeedback('请填写队员的用户名。')
      return
    }
    startTransition(async () => {
      const result = await assignRosterSeat(teamId, playerId, username)
      setFeedback(
        result.ok
          ? '已发送席位邀请，等待对方在“我的赛事”中确认。'
          : (result.error ?? '邀请失败，请稍后再试。'),
      )
      if (result.ok) {
        setActive(null)
        router.refresh()
      }
    })
  }

  return (
    <section className={styles.panel}>
      <h2>队员席位</h2>
      <p className={styles.lede}>
        填写用户名后会向该账号发送席位邀请；只有对方登录确认，赛事记录才会计入他的个人页。
      </p>
      {feedback ? <p className={styles.error}>{feedback}</p> : null}
      <ul className={styles.people}>
        {seats.map(seat => (
          <li key={seat.playerId}>
            <span>
              <strong>{seat.nickname}</strong>
              <small>
                {seat.isSubstitute ? '替补' : '首发'}
                {seat.holder ? ` · 已认领：${seat.holder}` : ' · 未认领'}
              </small>
            </span>
            {seat.holder ? null : active === seat.playerId ? (
              <form onSubmit={event => submit(event, seat.playerId)} className={styles.inviteForm}>
                <input name="username" placeholder="队员用户名" autoComplete="off" />
                <Button type="submit" size="mini" disabled={pending}>
                  发送邀请
                </Button>
              </form>
            ) : (
              <Button size="mini" variant="ghost" onClick={() => setActive(seat.playerId)}>
                邀请队员
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
