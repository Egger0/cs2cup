'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { ConfirmButton } from '@/components/ui'
import { formatSiteDateTime } from '@/lib/datetime'
import type { SquadTournament } from '@/lib/squad-registration'
import type { Squad } from '@/lib/squads'
import {
  disbandSquadAction,
  inviteToSquadAction,
  registerSquadAction,
  removeSquadMemberAction,
  revokeSquadInvitationAction,
} from './actions'
import { SquadFeedback } from './SquadFeedback'
import styles from './squads.module.css'
import { useSquadAction } from './useSquadAction'

const TEAM_STATUS = { pending: '审核中', approved: '已通过', rejected: '未通过' } as const

export function SquadCard({
  squad,
  viewerAccountId,
  tournaments,
}: {
  squad: Squad
  viewerAccountId: string
  tournaments: SquadTournament[]
}) {
  const { pending, feedback, run } = useSquadAction()
  const inviteForm = useRef<HTMLFormElement>(null)
  const captain = squad.captainAccountId === viewerAccountId
  const full = squad.members.length >= squad.rosterSize
  const titleId = `squad-${squad.id}`

  return (
    <article className={styles.card} aria-labelledby={titleId} aria-busy={pending}>
      <header className={styles.cardHead}>
        <span className={styles.eyebrow}>
          {squad.game.name} · {squad.members.length}/{squad.rosterSize}
        </span>
        <h2 id={titleId}>
          <span className={styles.tag}>{squad.tag}</span> {squad.name}
        </h2>
        {full ? <span className={styles.full}>满员</span> : null}
      </header>

      <ol className={styles.seats} aria-label="队员">
        {squad.members.map(member => (
          <li key={member.accountId} className={styles.seat}>
            <span className={styles.avatar} aria-hidden="true">
              {[...member.displayName][0]}
            </span>
            <span className={styles.seatName}>
              {member.handle ? (
                <Link href={`/players/${member.handle}`}>{member.displayName}</Link>
              ) : (
                member.displayName
              )}
              {member.captain ? <small>队长</small> : null}
            </span>
            {!member.captain && (captain || member.accountId === viewerAccountId) ? (
              <button
                type="button"
                className={styles.quietButton}
                disabled={pending}
                onClick={() => run(() => removeSquadMemberAction(squad.id, member.accountId))}
              >
                {member.accountId === viewerAccountId ? '离开小队' : '移出'}
              </button>
            ) : null}
          </li>
        ))}
        {Array.from(
          { length: Math.max(0, squad.rosterSize - squad.members.length) },
          (_, index) => (
            <li key={`empty-${index}`} className={`${styles.seat} ${styles.empty}`}>
              <span className={styles.avatar} aria-hidden="true">
                +
              </span>
              <span className={styles.seatName}>空位</span>
            </li>
          ),
        )}
      </ol>

      {captain && !full ? (
        <form
          ref={inviteForm}
          className={styles.invite}
          action={data =>
            run(
              () => inviteToSquadAction(squad.id, data),
              () => inviteForm.current?.reset(),
            )
          }
        >
          <label>
            <span>邀请队友</span>
            <input
              name="identifier"
              required
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="对方的用户名或公开主页地址"
            />
          </label>
          <button type="submit" className={styles.primaryButton} disabled={pending}>
            发出邀请
          </button>
        </form>
      ) : null}

      {captain && squad.invitations.length ? (
        <ul className={styles.pendingList} aria-label="等待回应的邀请">
          {squad.invitations.map(invitation => (
            <li key={invitation.id}>
              <span>{invitation.displayName} · 等待回应</span>
              <button
                type="button"
                className={styles.quietButton}
                disabled={pending}
                onClick={() => run(() => revokeSquadInvitationAction(invitation.id))}
              >
                撤回
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <section className={styles.entries} aria-label="赛事报名">
        <h3>报名赛事</h3>
        {tournaments.length ? (
          <ul>
            {tournaments.map(tournament => (
              <li key={tournament.id}>
                <div className={styles.entryTitle}>
                  <Link href={`/tournaments/${tournament.slug}`}>{tournament.title}</Link>
                  {tournament.regDeadline ? (
                    <small>报名截止 {formatSiteDateTime(tournament.regDeadline)}</small>
                  ) : null}
                </div>
                {tournament.teamStatus ? (
                  <Link className={styles.status} href={`/me/registrations/${tournament.teamId}`}>
                    {TEAM_STATUS[tournament.teamStatus]} →
                  </Link>
                ) : captain && full ? (
                  <form
                    className={styles.register}
                    action={data => run(() => registerSquadAction(squad.id, tournament.id, data))}
                  >
                    <input
                      name="contact"
                      required
                      maxLength={40}
                      aria-label="队长联系方式"
                      placeholder="联系方式：QQ / 微信"
                    />
                    <input
                      name="dept"
                      maxLength={30}
                      aria-label="学院"
                      placeholder="学院（选填）"
                    />
                    <button type="submit" className={styles.primaryButton} disabled={pending}>
                      以小队报名
                    </button>
                  </form>
                ) : (
                  <small>{full ? '由队长提交报名' : '满员后可报名'}</small>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            {squad.game.name}暂时没有开放报名的赛事，开放后会出现在这里。
          </p>
        )}
      </section>

      <SquadFeedback feedback={feedback} />

      {captain ? (
        <footer className={styles.cardFoot}>
          <ConfirmButton
            question="解散后队员和邀请都会清空，已提交的报名不受影响。"
            confirmLabel="确认解散"
            disabled={pending}
            onConfirm={() => run(() => disbandSquadAction(squad.id))}
          >
            解散小队
          </ConfirmButton>
        </footer>
      ) : null}
    </article>
  )
}
