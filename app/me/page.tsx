import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { participantSessionRemainingMs, requireParticipant } from '@/lib/participant-auth'
import { participantEntryAddedId } from '@/lib/participant-return'
import {
  listParticipantTournamentEntries,
  participantAccessReceipt,
} from '@/lib/queries/participant-account'
import { participantNextMatch } from '@/lib/queries/participant-next-match'
import { AccessReceipt } from './AccessReceipt'
import { EntryDossier } from './EntryDossier'
import styles from './me.module.css'
import { NextMatchBrief } from './NextMatchBrief'
import { ParticipantSessionBoundary, ParticipantSignOut } from './ParticipantSessionBoundary'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的赛事',
  description: '查看已绑定的赛事报名档案。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function ParticipantAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string | string[] }>
}) {
  const participant = await requireParticipant()
  const params = await searchParams
  const sessionRemainingMs = participantSessionRemainingMs(participant.sessionExpiresAt)
  const requestNow = participant.sessionExpiresAt - sessionRemainingMs
  const nextMatchRequest = participantNextMatch(participant.principalId, requestNow).catch(
    error => {
      console.error('[participant] next-match brief unavailable', error)
      return undefined
    },
  )
  const [entries, receipt, nextMatch] = await Promise.all([
    listParticipantTournamentEntries(participant.principalId),
    participantAccessReceipt(
      cloudflareBindings().db,
      participant.principalId,
      participant.credentialId,
    ),
    nextMatchRequest,
  ])
  if (!receipt) redirect('/login?reason=expired')
  const briefNow =
    participant.sessionExpiresAt - participantSessionRemainingMs(participant.sessionExpiresAt)
  const hasApprovedEntry = entries.some(entry => entry.team.status === 'approved')
  const hasPendingEntry = entries.some(entry => entry.team.status === 'pending')
  const addedTeamId = participantEntryAddedId(params.joined)
  const addedEntry =
    addedTeamId === null ? undefined : entries.find(entry => entry.team.id === addedTeamId)

  return (
    <ParticipantSessionBoundary sessionRemainingMs={sessionRemainingMs}>
      <main id="main" className={styles.page}>
        <header className={styles.topbar}>
          {/* Sensitive archive exits intentionally bypass the client route cache. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={styles.brand}>
            <span aria-hidden="true">
              <Image src="/brand/club-mark.svg" alt="" width={28} height={28} priority />
            </span>
            宁波理工电竞社
          </a>
          <ParticipantSignOut />
        </header>

        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>PARTICIPANT ARCHIVE / 参赛者档案</p>
            <h1>我的赛事卷宗</h1>
          </div>
          <aside
            aria-label={addedEntry ? '报名归档结果' : '档案使用说明'}
            role={addedEntry ? 'status' : undefined}
            aria-live={addedEntry ? 'polite' : undefined}
            aria-atomic={addedEntry ? true : undefined}
          >
            <strong>{addedEntry ? '报名已成功归档' : '只读档案'}</strong>
            <p>
              {addedEntry
                ? `[${addedEntry.team.tag}] ${addedEntry.team.name} 已加入当前赛事通行证，可在下方卷宗中查看。修改仍请使用报名回执中的原管理链接。`
                : '这里记录你已绑定的报名。修改仍请使用报名回执中的原管理链接；为保护报名权限，本页不会恢复、推导或显示管理 Token。'}
            </p>
          </aside>
        </div>

        {nextMatch !== undefined && (hasApprovedEntry || hasPendingEntry) ? (
          <NextMatchBrief
            nextMatch={nextMatch}
            emptyReason={hasApprovedEntry ? 'standby' : 'review'}
            initialNow={briefNow}
          />
        ) : null}

        {entries.length ? (
          <section className={styles.files} aria-label="已绑定的赛事报名">
            {entries.map(entry => (
              <EntryDossier key={entry.team.id} entry={entry} />
            ))}
          </section>
        ) : (
          <section className={styles.empty} aria-labelledby="empty-title">
            <p>ARCHIVE / EMPTY</p>
            <h2 id="empty-title">尚无已绑定的赛事报名</h2>
            <span>请从报名回执的原管理链接完成绑定，之后档案会出现在这里。</span>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/tournaments">浏览公开赛事</a>
          </section>
        )}

        <AccessReceipt receipt={receipt} sessionExpiresAt={participant.sessionExpiresAt} />
      </main>
    </ParticipantSessionBoundary>
  )
}
