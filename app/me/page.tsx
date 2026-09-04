import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountSignOut } from '@/app/account/AccountSignOut'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { getAuthContext, type AuthenticatedAuthContext } from '@/lib/identity/kernel'
import {
  listAccountTournamentRegistrations,
  listIncomingRegistrationInvitations,
  listRegistrationDrafts,
} from '@/lib/identity/registration-workflow'
import { participantSessionRemainingMs, requireParticipant } from '@/lib/participant-auth'
import { parsePageNumber } from '@/lib/pagination'
import { participantEntryAddedId } from '@/lib/participant-return'
import {
  listParticipantTournamentEntries,
  participantAccessReceipt,
} from '@/lib/queries/participant-account'
import {
  accountNextMatchFromDatabase,
  participantNextMatch,
} from '@/lib/queries/participant-next-match'
import {
  listCurrentParticipantCheckInWorkspaces,
  listCurrentUnifiedTournamentWorkspaces,
} from '@/lib/queries/staff-check-in'
import { maskParticipantPrincipal } from '@/lib/tournament-staff-management'
import { AccessReceipt } from './AccessReceipt'
import { EntryDossier } from './EntryDossier'
import styles from './me.module.css'
import { NextMatchBrief } from './NextMatchBrief'
import { PassReference } from './PassReference'
import { ParticipantSessionBoundary, ParticipantSignOut } from './ParticipantSessionBoundary'
import { RegistrationInvitations } from './RegistrationInvitations'
import { StaffWorkspaces } from './StaffWorkspaces'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的赛事',
  description: '查看账号下的赛事报名记录。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

const STAFF_PAGE_SIZE = 12

async function UnifiedAccountEvents({
  context,
  staffPage,
}: {
  context: AuthenticatedAuthContext
  staffPage: number
}) {
  const database = cloudflareBindings().db
  const now = currentTimeMillis()
  const nextMatchRequest = accountNextMatchFromDatabase(database, context.account.id, now).catch(
    error => {
      console.error('[account] next-match brief unavailable', error)
      return undefined
    },
  )
  const [entries, invitations, drafts, workspacePage, nextMatch] = await Promise.all([
    listAccountTournamentRegistrations(database, context, now),
    listIncomingRegistrationInvitations(database, context, now),
    listRegistrationDrafts(database, context, now),
    listCurrentUnifiedTournamentWorkspaces({
      checkInOnly: true,
      limit: STAFF_PAGE_SIZE,
      offset: (staffPage - 1) * STAFF_PAGE_SIZE,
    }),
    nextMatchRequest,
  ])
  const staffPages = Math.max(1, Math.ceil(workspacePage.total / STAFF_PAGE_SIZE))
  if (staffPage > staffPages) redirect(staffPages === 1 ? '/me' : `/me?staffPage=${staffPages}`)
  const hasApprovedEntry = entries.some(entry => entry.team.status === 'approved')
  const hasPendingEntry = entries.some(entry => entry.team.status === 'pending')

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <span aria-hidden="true">
            <Image src="/brand/club-mark.svg" alt="" width={28} height={28} priority />
          </span>
          宁波理工电竞社
        </Link>
        <nav aria-label="账号导航" className={styles.accountNav}>
          <Link href="/account">我的账号</Link>
          <Link href="/account/security">账号与安全</Link>
          <AccountSignOut />
        </nav>
      </header>

      <main id="main">
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>ACCOUNT / 我的赛事</p>
            <h1>我的赛事</h1>
          </div>
          <aside aria-label="账号赛事说明">
            <strong>{context.account.displayName}</strong>
            <p>报名、审核状态和协作权限都随当前账号保存，不需要另外保管管理链接。</p>
          </aside>
        </div>

        <RegistrationInvitations items={invitations} />

        <StaffWorkspaces
          workspaces={workspacePage.workspaces}
          total={workspacePage.total}
          page={staffPage}
          pages={staffPages}
        />

        {nextMatch !== undefined && (hasApprovedEntry || hasPendingEntry) ? (
          <NextMatchBrief
            nextMatch={nextMatch}
            emptyReason={hasApprovedEntry ? 'standby' : 'review'}
            initialNow={now}
          />
        ) : null}

        {drafts.length ? (
          <section className={styles.drafts} aria-labelledby="drafts-title">
            <header>
              <p>DRAFTS / 草稿</p>
              <h2 id="drafts-title">待完成的报名</h2>
            </header>
            <div>
              {drafts.map(draft => (
                <article key={draft.tournament.id}>
                  <span>{draft.tournament.title}</span>
                  <strong>{draft.values.name || '尚未填写战队名称'}</strong>
                  <Link href={`/tournaments/${encodeURIComponent(draft.tournament.slug)}/register`}>
                    继续填写 →
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {entries.length ? (
          <section className={styles.files} aria-label="我的赛事报名">
            {entries.map(entry => (
              <EntryDossier
                key={entry.team.id}
                entry={entry}
                relationship={entry.relationship}
                managementHref={`/me/registrations/${entry.team.id}`}
              />
            ))}
          </section>
        ) : (
          <section className={styles.empty} aria-labelledby="empty-title">
            <p>REGISTRATION / EMPTY</p>
            <h2 id="empty-title">还没有赛事报名</h2>
            <span>从开放报名的赛事开始组队；保存过的草稿也会显示在这里。</span>
            <Link href="/tournaments">浏览公开赛事</Link>
          </section>
        )}
      </main>
    </div>
  )
}

export default async function ParticipantAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string | string[]; staffPage?: string | string[] }>
}) {
  const params = await searchParams
  const staffPage = parsePageNumber(params.staffPage, STAFF_PAGE_SIZE)
  const identity = await getAuthContext()
  if (identity.kind === 'authenticated') {
    if (identity.session.recoveryRestricted) redirect('/account/security?recovery=1')
    return <UnifiedAccountEvents context={identity} staffPage={staffPage} />
  }
  const participant = await requireParticipant()
  const sessionRemainingMs = participantSessionRemainingMs(participant.sessionExpiresAt)
  const requestNow = participant.sessionExpiresAt - sessionRemainingMs
  const nextMatchRequest = participantNextMatch(participant.principalId, requestNow).catch(
    error => {
      console.error('[participant] next-match brief unavailable', error)
      return undefined
    },
  )
  const [entries, receipt, nextMatch, workspacePage] = await Promise.all([
    listParticipantTournamentEntries(participant.principalId),
    participantAccessReceipt(
      cloudflareBindings().db,
      participant.principalId,
      participant.credentialId,
    ),
    nextMatchRequest,
    listCurrentParticipantCheckInWorkspaces({
      limit: STAFF_PAGE_SIZE,
      offset: (staffPage - 1) * STAFF_PAGE_SIZE,
    }),
  ])
  if (!receipt) redirect('/login?reason=expired')
  const staffPages = Math.max(1, Math.ceil(workspacePage.total / STAFF_PAGE_SIZE))
  if (staffPage > staffPages) redirect(staffPages === 1 ? '/me' : `/me?staffPage=${staffPages}`)
  const briefNow =
    participant.sessionExpiresAt - participantSessionRemainingMs(participant.sessionExpiresAt)
  const hasApprovedEntry = entries.some(entry => entry.team.status === 'approved')
  const hasPendingEntry = entries.some(entry => entry.team.status === 'pending')
  const addedTeamId = participantEntryAddedId(params.joined)
  const addedEntry =
    addedTeamId === null ? undefined : entries.find(entry => entry.team.id === addedTeamId)

  return (
    <ParticipantSessionBoundary sessionRemainingMs={sessionRemainingMs}>
      <div className={styles.page}>
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

        <main id="main">
          <div className={styles.intro}>
            <div>
              <p className={styles.eyebrow}>LEGACY ACCESS / 旧登录方式</p>
              <h1>我的赛事</h1>
            </div>
            <aside
              aria-label={addedEntry ? '报名关联结果' : '旧登录方式说明'}
              role={addedEntry ? 'status' : undefined}
              aria-live={addedEntry ? 'polite' : undefined}
              aria-atomic={addedEntry ? true : undefined}
            >
              <strong>{addedEntry ? '报名已成功关联' : '只读报名记录'}</strong>
              <p>
                {addedEntry
                  ? `[${addedEntry.team.tag}] ${addedEntry.team.name} 已关联到当前旧登录方式，可在下方查看。修改仍请使用报名回执中的报名管理链接。`
                  : '这里显示通过旧登录方式关联的报名。修改仍请使用报名回执中的报名管理链接；本页不会恢复、推导或显示链接中的私密凭据。'}
              </p>
            </aside>
          </div>

          <PassReference participantReference={maskParticipantPrincipal(participant.principalId)} />

          <StaffWorkspaces
            workspaces={workspacePage.workspaces}
            total={workspacePage.total}
            page={staffPage}
            pages={staffPages}
          />

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
              <p>REGISTRATION / EMPTY</p>
              <h2 id="empty-title">尚无已绑定的赛事报名</h2>
              <span>请从报名回执中的报名管理链接完成关联，之后记录会出现在这里。</span>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/tournaments">浏览公开赛事</a>
            </section>
          )}

          <AccessReceipt receipt={receipt} sessionExpiresAt={participant.sessionExpiresAt} />
        </main>
      </div>
    </ParticipantSessionBoundary>
  )
}
