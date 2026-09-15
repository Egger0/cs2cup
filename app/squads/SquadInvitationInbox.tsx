'use client'

import type { SquadInvitation } from '@/lib/squads'
import { respondToSquadInvitationAction } from './actions'
import { SquadFeedback } from './SquadFeedback'
import styles from './squads.module.css'
import { useSquadAction } from './useSquadAction'

export function SquadInvitationInbox({ items }: { items: SquadInvitation[] }) {
  const { pending, feedback, run } = useSquadAction()
  if (!items.length && !feedback) return null

  return (
    <section className={styles.inbox} aria-labelledby="squad-inbox-title" aria-busy={pending}>
      <header>
        <span className={styles.eyebrow}>INBOX / 站内信</span>
        <h2 id="squad-inbox-title">组队邀请</h2>
      </header>
      <SquadFeedback feedback={feedback} />
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <div>
              <small>{item.gameName}</small>
              <strong>
                [{item.squadTag}] {item.squadName}
              </strong>
              <span>
                {item.inviterName} 邀请你加入 · 还剩 {item.openSeats} 个空位
              </span>
            </div>
            <div className={styles.inboxActions}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={pending || item.openSeats < 1}
                onClick={() => run(() => respondToSquadInvitationAction(item.id, true))}
              >
                加入小队
              </button>
              <button
                type="button"
                className={styles.quietButton}
                disabled={pending}
                onClick={() => run(() => respondToSquadInvitationAction(item.id, false))}
              >
                婉拒
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
