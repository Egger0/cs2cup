import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { AccountShell } from '@/components/account/AccountShell'
import { PageMasthead } from '@/components/domain/Sections'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { accountHasWorkAccess } from '@/lib/identity/account-security-state'
import { getAuthContext, type AuthenticatedAuthContext } from '@/lib/identity/kernel'
import {
  listAccountTournamentRegistrations,
  listIncomingRegistrationInvitations,
  listRegistrationDrafts,
} from '@/lib/identity/registration-workflow'
import { listIncomingRosterClaimRequests } from '@/lib/identity/roster-claim'
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
import { RosterClaimRequests } from './RosterClaimRequests'
import { StaffWorkspaces } from './StaffWorkspaces'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的赛事',
  description: '查看账号下的赛事报名记录。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

const STAFF_PAGE_SIZE = 12

type Probe<T> = { label: string; value: T } | { label: string; failure: string }

async function probe<T>(label: string, work: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { label, value: await work() }
  } catch (error) {
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}\ncause: ${String((error as { cause?: unknown }).cause ?? '')}`
        : String(error)
    console.error(`[diag] ${label} failed`, error)
    return { label, failure: detail }
  }
}

function Diagnostics({ failures }: { failures: { label: string; failure?: string }[] }) {
  return (
    <div style={{ padding: '32px', fontFamily: 'monospace', fontSize: '13px' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>/me diagnostics</h1>
      {failures.map(item => (
        <section key={item.label} style={{ marginBottom: '24px' }}>
          <strong>{item.label}</strong>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '8px' }}>
            {item.failure}
          </pre>
        </section>
      ))}
    </div>
  )
}

function EmptyEntries({ hint }: { hint: ReactNode }) {
  return (
    <section className={styles.empty} aria-labelledby="empty-title">
      <h2 id="empty-title">还没有赛事报名</h2>
      <p>{hint}</p>
      <Link href="/tournaments">浏览公开赛事</Link>
    </section>
  )
}

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
  const probes = await Promise.all([
    probe('registrations', () => listAccountTournamentRegistrations(database, context, now)),
    probe('invitations', () => listIncomingRegistrationInvitations(database, context, now)),
    probe('rosterClaims', () => listIncomingRosterClaimRequests(database, context, now)),
    probe('drafts', () => listRegistrationDrafts(database, context, now)),
    probe('workspaces', () =>
      listCurrentUnifiedTournamentWorkspaces({
        checkInOnly: true,
        limit: STAFF_PAGE_SIZE,
        offset: (staffPage - 1) * STAFF_PAGE_SIZE,
      }),
    ),
    probe('nextMatch', () => nextMatchRequest),
    probe('workAccess', () => accountHasWorkAccess(database, context.account.id, now)),
  ])
  const failures = probes.filter(result => 'failure' in result)
  if (failures.length) return <Diagnostics failures={failures} />
  const [entries, invitations, rosterClaimRequests, drafts, workspacePage, nextMatch, workAccess] =
    probes.map(result => ('value' in result ? result.value : undefined)) as [
      Awaited<ReturnType<typeof listAccountTournamentRegistrations>>,
      Awaited<ReturnType<typeof listIncomingRegistrationInvitations>>,
      Awaited<ReturnType<typeof listIncomingRosterClaimRequests>>,
      Awaited<ReturnType<typeof listRegistrationDrafts>>,
      Awaited<ReturnType<typeof listCurrentUnifiedTournamentWorkspaces>>,
      Awaited<typeof nextMatchRequest>,
      boolean,
    ]
  const staffPages = Math.max(1, Math.ceil(workspacePage.total / STAFF_PAGE_SIZE))
  if (staffPage > staffPages) redirect(staffPages === 1 ? '/me' : `/me?staffPage=${staffPages}`)
  const hasApprovedEntry = entries.some(entry => entry.team.status === 'approved')
  const hasPendingEntry = entries.some(entry => entry.team.status === 'pending')

  return (
    <AccountShell
      access={{ hasWorkAccess: workAccess, recoveryRestricted: false }}
      identity={context.account.displayName}
    >
      <PageMasthead
        title="我的赛事"
        lede="报名、审核状态和协作权限都保存在这个账号下，不需要另外保管管理链接。"
      />

      <RegistrationInvitations items={invitations} />
      <RosterClaimRequests items={rosterClaimRequests} />

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
          <h2 id="drafts-title">待完成的报名</h2>
          <div>
            {drafts.map(draft => (
              <article key={draft.tournament.id}>
                <span>{draft.tournament.title}</span>
                <strong>{draft.values.name || '尚未填写战队名称'}</strong>
                <Link href={`/tournaments/${encodeURIComponent(draft.tournament.slug)}/register`}>
                  继续填写
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
        <EmptyEntries hint="从开放报名的赛事开始组队；保存过的草稿也会显示在这里。" />
      )}
    </AccountShell>
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
      <AccountShell
        access={null}
        identity="旧登录方式"
        sections={[]}
        signOut={<ParticipantSignOut />}
      >
        <PageMasthead
          title="我的赛事"
          lede="这里显示通过旧登录方式关联的报名。修改仍请使用报名回执中的报名管理链接；本页不会显示链接中的私密凭据。"
        />

        {addedEntry ? (
          <p className={styles.notice} role="status" aria-live="polite" aria-atomic="true">
            [{addedEntry.team.tag}] {addedEntry.team.name} 已关联到当前旧登录方式，可在下方查看。
          </p>
        ) : null}

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
          <EmptyEntries hint="请从报名回执中的报名管理链接完成关联，之后记录会出现在这里。" />
        )}

        <AccessReceipt receipt={receipt} sessionExpiresAt={participant.sessionExpiresAt} />
      </AccountShell>
    </ParticipantSessionBoundary>
  )
}
