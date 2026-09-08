'use client'

import { useState, useTransition, type FormEvent } from 'react'

import { confirmRosterSeat } from '@/app/admin/(console)/actions/teams'
import { Button } from '@/components/ui'
import type { TournamentCheckInSeat } from '@/lib/queries/staff-check-in'
import styles from './CheckInDesk.module.css'

export function CheckInSeats({
  tournamentId,
  seats,
  disabled,
}: {
  tournamentId: number
  seats: TournamentCheckInSeat[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [held, setHeld] = useState<Record<number, string>>({})
  const [active, setActive] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (seats.length === 0) return null

  const holderOf = (seat: TournamentCheckInSeat) => held[seat.playerId] ?? seat.holder
  const remaining = seats.filter(seat => !holderOf(seat)).length

  const submit = (event: FormEvent<HTMLFormElement>, playerId: number) => {
    event.preventDefault()
    const username = new FormData(event.currentTarget).get('username')
    if (typeof username !== 'string' || !username.trim()) {
      setError('请填写队员的用户名。')
      return
    }
    startTransition(async () => {
      const result = await confirmRosterSeat(tournamentId, playerId, username)
      if (result.ok && result.holder) {
        setHeld(current => ({ ...current, [playerId]: result.holder as string }))
        setActive(null)
        setError(null)
      } else {
        setError(result.error ?? '确认失败，请稍后再试。')
      }
    })
  }

  return (
    <div className={styles.seats}>
      <button type="button" className={styles.seatsToggle} onClick={() => setOpen(!open)}>
        {open ? '收起队员席位' : `队员席位 · ${remaining} 人未认领`}
      </button>
      {open ? (
        <>
          {error ? <p className={styles.seatsError}>{error}</p> : null}
          <ul className={styles.seatsList}>
            {seats.map(seat => {
              const holder = holderOf(seat)
              return (
                <li key={seat.playerId}>
                  <span>
                    <strong>{seat.nickname}</strong>
                    <small>{seat.isSubstitute ? '替补' : '首发'}</small>
                  </span>
                  {holder ? (
                    <small>{holder}</small>
                  ) : active === seat.playerId ? (
                    <form onSubmit={event => submit(event, seat.playerId)}>
                      <input name="username" placeholder="用户名" autoComplete="off" />
                      <Button type="submit" size="mini" disabled={pending || disabled}>
                        确认
                      </Button>
                    </form>
                  ) : (
                    <Button
                      type="button"
                      size="mini"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setActive(seat.playerId)}
                    >
                      本人到场
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}
