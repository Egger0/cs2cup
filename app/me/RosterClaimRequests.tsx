'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'
import type { RosterClaimRequest } from '@/lib/identity/roster-claim'
import { acceptRosterSeatInvitation } from './registrations/actions'
import styles from './registration-invitations.module.css'

export function RosterClaimRequests({ items }: { items: RosterClaimRequest[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<string | null>(null)
  if (!items.length) return null

  return (
    <section className={styles.panel} aria-labelledby="roster-claim-requests" aria-busy={pending}>
      <header>
        <p>ROSTER / 待确认</p>
        <h2 id="roster-claim-requests">队员席位邀请</h2>
      </header>
      {feedback ? (
        <p className={styles.error} role="alert">
          {feedback}
        </p>
      ) : null}
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <div>
              <small>{item.tournamentTitle}</small>
              <strong>
                [{item.teamTag}] {item.teamName} · {item.nickname}
              </strong>
              <span>{item.inviterName} 邀请你认领这个队员席位。</span>
            </div>
            <Button
              type="button"
              size="mini"
              variant="primary"
              disabled={pending}
              onClick={() => {
                setFeedback(null)
                startTransition(async () => {
                  const result = await acceptRosterSeatInvitation(item.id)
                  if (result.ok) {
                    router.refresh()
                    return
                  }
                  setFeedback(result.error ?? '接受失败，请稍后重试。')
                })
              }}
            >
              确认认领
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
