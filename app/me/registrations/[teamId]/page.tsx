import type { Metadata } from 'next'
import { tournamentRosterSize } from '@/lib/queries/roster-size'
import { notFound, redirect } from 'next/navigation'

import { RegistrationManager } from '@/app/(public)/tournaments/[slug]/registration/[token]/RegistrationManager'
import { AccountShell } from '@/components/account/AccountShell'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { formatSiteDateTime } from '@/lib/datetime'
import { getAuthContext } from '@/lib/identity/kernel'
import { accountHasWorkAccess } from '@/lib/identity/account-security-state'
import {
  getAccountManagedRegistration,
  RegistrationManagementError,
} from '@/lib/queries/registration-management'
import { CancelRegistration } from '../CancelRegistration'
import styles from './registration.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '管理赛事报名',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

const STATUS_LABEL = {
  pending: '等待审核',
  approved: '审核通过',
  rejected: '未通过审核',
} as const

export default async function AccountRegistrationPage({
  params,
}: {
  params: Promise<{ teamId: string }>
}) {
  const teamId = Number((await params).teamId)
  if (!Number.isSafeInteger(teamId) || teamId <= 0) notFound()
  const database = cloudflareBindings().db
  const context = await getAuthContext({ database })
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account')
  if (context.session.recoveryRestricted) redirect('/account/security?recovery=1')

  let registration
  try {
    registration = await getAccountManagedRegistration(database, context, teamId)
  } catch (error) {
    if (error instanceof RegistrationManagementError && error.code === 'reauth_required') {
      redirect('/login?reauth=1&redirectKey=account')
    }
    notFound()
  }
  const deadline = registration.tournament.regDeadline
    ? formatSiteDateTime(registration.tournament.regDeadline)
    : null

  const hasWorkAccess = await accountHasWorkAccess(database, context.account.id)

  return (
    <AccountShell
      access={{ hasWorkAccess, recoveryRestricted: false }}
      identity={context.account.displayName}
      title={registration.tournament.title}
      lede={`[${registration.team.tag}] ${registration.team.name}`}
    >
      <dl className={styles.status}>
        <div>
          <dt>审核状态</dt>
          <dd>{STATUS_LABEL[registration.team.status]}</dd>
        </div>
        <div>
          <dt>报名截止</dt>
          <dd>{deadline ?? '未设置'}</dd>
        </div>
      </dl>

      <section className={styles.editor} aria-labelledby="editor-title">
        <h2 id="editor-title">阵容与联系方式</h2>
        {registration.editable ? (
          <RegistrationManager
            access="account"
            teamId={teamId}
            team={registration.team}
            revision={registration.revision}
            starterCount={await tournamentRosterSize(cloudflareBindings().db, { teamId })}
          />
        ) : (
          <div className={styles.locked}>
            <strong>当前报名资料已锁定</strong>
            <p>审核完成或报名截止后，需由赛事负责人协助更正。</p>
            <dl>
              <div>
                <dt>队长</dt>
                <dd>{registration.team.captain}</dd>
              </div>
              <div>
                <dt>联系方式</dt>
                <dd>{registration.team.contact}</dd>
              </div>
              <div>
                <dt>阵容</dt>
                <dd>{registration.team.players.map(player => player.nickname).join('、')}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {registration.relationship === 'owner' ? (
        <CancelRegistration teamId={teamId} deletable={registration.team.status === 'pending'} />
      ) : null}
    </AccountShell>
  )
}
