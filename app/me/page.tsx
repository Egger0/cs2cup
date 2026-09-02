import type { Metadata } from 'next'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { participantSessionRemainingMs, requireParticipant } from '@/lib/participant-auth'
import {
  listParticipantTournamentEntries,
  participantAccessReceipt,
} from '@/lib/queries/participant-account'
import { AccessReceipt } from './AccessReceipt'
import { EntryDossier } from './EntryDossier'
import styles from './me.module.css'
import { ParticipantSessionBoundary, ParticipantSignOut } from './ParticipantSessionBoundary'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的赛事',
  description: '查看已绑定的赛事报名档案。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function ParticipantAccountPage() {
  const participant = await requireParticipant()
  const [entries, receipt] = await Promise.all([
    listParticipantTournamentEntries(participant.principalId),
    participantAccessReceipt(
      cloudflareBindings().db,
      participant.principalId,
      participant.credentialId,
    ),
  ])
  if (!receipt) redirect('/login?reason=expired')
  const sessionRemainingMs = participantSessionRemainingMs(participant.sessionExpiresAt)

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
          <aside aria-label="档案使用说明">
            <strong>只读档案</strong>
            <p>
              这里记录你已绑定的报名。修改仍请使用报名回执中的原管理链接；为保护报名权限，本页不会恢复、推导或显示管理
              Token。
            </p>
          </aside>
        </div>

        <AccessReceipt receipt={receipt} sessionExpiresAt={participant.sessionExpiresAt} />

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
      </main>
    </ParticipantSessionBoundary>
  )
}
