import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { signOut } from '@/app/admin/(console)/actions/auth'
import { AccountSignOut } from '@/app/account/AccountSignOut'
import {
  ParticipantSignOut,
  PrivateSessionActionForm,
  PrivateSessionBoundary,
} from '@/app/me/ParticipantSessionBoundary'
import { staffSessionRemainingMs, TournamentStaffAccessError } from '@/lib/auth'
import { participantStaffCheckInPath } from '@/lib/participant-return'
import { getTournamentCheckInDesk } from '@/lib/queries/staff-check-in'
import type { TournamentStatus } from '@/lib/types'
import { CheckInDesk } from './CheckInDesk'
import styles from './check-in.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '现场签到',
  description: '赛事工作人员现场签到台。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名中',
  running: '进行中',
  finished: '已结束',
  postponed: '已延期',
}

function positiveId(value: string) {
  if (!/^[1-9][0-9]{0,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export default async function TournamentCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tournamentId = positiveId((await params).id)
  if (tournamentId === null) notFound()
  const returnTo = participantStaffCheckInPath(tournamentId)
  if (!returnTo) notFound()

  let desk
  try {
    desk = await getTournamentCheckInDesk(tournamentId)
  } catch (error) {
    if (!(error instanceof TournamentStaffAccessError)) throw error
    if (error.access.reason === 'forbidden') notFound()
    if (
      error.access.reason === 'expired' &&
      error.access.hadAdminCookie &&
      !error.access.hadParticipantCookie
    ) {
      redirect('/admin/login')
    }
    const reason =
      error.access.reason === 'expired'
        ? 'reason=expired&'
        : error.access.reason === 'conflict'
          ? 'reason=conflict&'
          : ''
    redirect(`/login?${reason}returnTo=${encodeURIComponent(returnTo)}`)
  }
  if (!desk) notFound()

  const isParticipant = desk.actor.kind === 'participant'
  const isUnified = desk.actor.kind === 'unified'
  const page = (
    <div className={styles.page}>
      <header className={styles.topbar}>
        {/* Private workspaces use full navigations so cached content is never restored in place. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/" className={styles.brand}>
          <Image src="/brand/club-mark.svg" alt="" width={34} height={34} priority />
          <span>
            宁波理工电竞社
            <small>CLUB OPERATIONS</small>
          </span>
        </a>
        <div className={styles.session}>
          <span aria-hidden="true" />
          <p>
            {isParticipant || isUnified ? '赛事工作人员' : '平台负责人'}
            <small>权限按本届赛事核验</small>
          </p>
        </div>
        <nav className={styles.nav} aria-label="签到台辅助导航">
          <a href={isParticipant ? '/me' : '/admin'}>
            {isParticipant ? '返回我的赛事' : isUnified ? '返回工作区' : '返回管理台'}
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className={styles.publicLink}>
            公开网站
          </a>
          {isParticipant ? (
            <ParticipantSignOut label="安全退出" />
          ) : isUnified ? (
            <AccountSignOut />
          ) : (
            <PrivateSessionActionForm action={signOut} label="安全退出" />
          )}
        </nav>
      </header>

      <main id="main" className={styles.main}>
        <section className={styles.masthead} aria-labelledby="check-in-title">
          <div>
            <p className={styles.eyebrow}>FIELD OPS / CHECK-IN</p>
            <h1 id="check-in-title">现场签到</h1>
          </div>
          <div className={styles.event}>
            <span>EVENT / {String(desk.tournament.id).padStart(2, '0')}</span>
            <strong>{desk.tournament.title}</strong>
            <p>
              {desk.tournament.season} · 第 {desk.tournament.edition} 届 ·{' '}
              {STATUS_LABEL[desk.tournament.status]}
            </p>
          </div>
        </section>

        <CheckInDesk
          authorizationRecoveryPath={
            isParticipant ? returnTo : isUnified ? '/account' : '/admin/login'
          }
          initialTeams={desk.teams}
          tournamentId={desk.tournament.id}
        />

        <footer className={styles.footer}>
          <span>名单仅包含已审核通过的战队</span>
          <span>签到状态以服务器记录为准</span>
        </footer>
      </main>
    </div>
  )

  return (
    <PrivateSessionBoundary
      observeParticipantSession={isParticipant}
      returnTo={returnTo}
      sessionEndDestination={isParticipant || isUnified ? returnTo : '/admin/login'}
      sessionRemainingMs={staffSessionRemainingMs(desk.actor.sessionExpiresAt)}
    >
      {page}
    </PrivateSessionBoundary>
  )
}
