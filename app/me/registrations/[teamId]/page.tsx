import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { RegistrationManager } from '@/app/(public)/tournaments/[slug]/registration/[token]/RegistrationManager'
import { AccountSignOut } from '@/app/account/AccountSignOut'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { formatSiteDateTime } from '@/lib/datetime'
import { getAuthContext } from '@/lib/identity/kernel'
import { registrationAccessOverview } from '@/lib/identity/registration-workflow'
import {
  getAccountManagedRegistration,
  RegistrationManagementError,
} from '@/lib/queries/registration-management'
import { RegistrationAccessPanel } from '../RegistrationAccessPanel'
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
  const access =
    registration.relationship === 'owner'
      ? await registrationAccessOverview(database, context, teamId)
      : { managers: [], invitations: [] }
  const deadline = registration.tournament.regDeadline
    ? formatSiteDateTime(registration.tournament.regDeadline)
    : null

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/club-mark.svg" alt="" width={28} height={28} priority />
          <span>宁波理工电竞社</span>
        </Link>
        <nav aria-label="报名管理导航">
          <Link href="/me">我的赛事</Link>
          <Link href="/account">我的账号</Link>
          <AccountSignOut />
        </nav>
      </header>

      <main id="main">
        <div className={styles.shell}>
          <header className={styles.heading}>
            <div>
              <p>REGISTRATION / {registration.tournament.slug}</p>
              <h1>{registration.tournament.title}</h1>
              <span>
                [{registration.team.tag}] {registration.team.name}
              </span>
            </div>
            <aside>
              <small>{registration.relationship === 'owner' ? '所有者' : '协作者'}</small>
              <strong>{STATUS_LABEL[registration.team.status]}</strong>
              <span>{deadline ? `报名截止 ${deadline}` : '未设置报名截止时间'}</span>
            </aside>
          </header>

          <section className={styles.editor} aria-labelledby="editor-title">
            <div className={styles.sectionHead}>
              <p>TEAM / 报名资料</p>
              <h2 id="editor-title">阵容与联系方式</h2>
            </div>
            {registration.editable ? (
              <RegistrationManager
                access="account"
                teamId={teamId}
                team={registration.team}
                revision={registration.revision}
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

          <RegistrationAccessPanel
            teamId={teamId}
            relationship={registration.relationship}
            managers={access.managers}
            invitations={access.invitations}
            deletable={registration.team.status === 'pending'}
          />
        </div>
      </main>
    </div>
  )
}
