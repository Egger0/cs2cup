import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { AccountShell } from '@/components/account/AccountShell'
import { RegistrationJourney } from '@/components/domain/RegistrationJourney'
import { PageMasthead } from '@/components/domain/Sections'
import { CommunityChannels } from '@/components/layout/CommunityChannels'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { accountOverview } from '@/lib/identity/account-overview'
import { getAuthContext } from '@/lib/identity/kernel'
import { FALLBACK_SITE_SETTING, getSiteSetting, safely } from '@/lib/queries/public'
import { registrationAuthHref, registrationSlug } from '@/lib/registration-navigation'
import { MembershipPanel } from './MembershipPanel'
import { ProfileNameForm } from './ProfileNameForm'
import { PublicHandleForm } from './PublicHandleForm'
import { WelcomeDialog } from './WelcomeDialog'
import styles from './account.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '我的账号',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string | string[]; tournamentSlug?: string | string[] }>
}) {
  const [params, context, setting] = await Promise.all([
    searchParams,
    getAuthContext(),
    safely(getSiteSetting, FALLBACK_SITE_SETTING),
  ])
  const entrySlug = registrationSlug(params.tournamentSlug)
  if (context.kind === 'anonymous')
    redirect(entrySlug ? registrationAuthHref('login', entrySlug) : '/login?redirectKey=account')
  if (context.session.recoveryRestricted) redirect('/account/security?recovery=1')
  const database = cloudflareBindings().db
  const now = currentTimeMillis()
  const overview = await accountOverview(database, context, now)
  if (!overview) redirect('/login?error=expired')

  return (
    <AccountShell
      access={{ hasWorkAccess: overview.hasWorkAccess, recoveryRestricted: false }}
      identity={overview.account.displayName}
      masthead={
        <PageMasthead
          code="ACCOUNT"
          eyebrow="账号中心"
          title="我的账号"
          lede="显示名称、公开主页和成员资格都保存在这个账号下。"
          density="compact"
        />
      }
    >
      {entrySlug ? (
        <RegistrationJourney
          slug={entrySlug}
          accountReady
          membershipReady={overview.membership.status === 'approved'}
        />
      ) : null}

      {params.welcome === '1' ? (
        <WelcomeDialog>
          <CommunityChannels contactQq={(setting ?? FALLBACK_SITE_SETTING).contactQq} />
        </WelcomeDialog>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.column}>
          <section className={styles.profile} aria-labelledby="profile-title">
            <h2 id="profile-title">个人资料</h2>
            <dl className={styles.rows}>
              <div>
                <dt>显示名称</dt>
                <dd>
                  <span>{overview.account.displayName}</span>
                  <ProfileNameForm displayName={overview.account.displayName} />
                </dd>
              </div>
              <div>
                <dt>用户名</dt>
                <dd>
                  <span className={styles.mono}>
                    {overview.account.username ? `@${overview.account.username}` : '待设置'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>公开主页</dt>
                <dd>
                  <PublicHandleForm handle={overview.account.publicHandle} />
                </dd>
              </div>
            </dl>
          </section>

          <MembershipPanel
            membership={overview.membership}
            now={now}
            lastReminderAt={overview.membership.application?.lastReminderAt ?? null}
          />
        </div>

        <section className={styles.security} aria-labelledby="security-title">
          <h2 id="security-title">登录与安全</h2>
          <dl className={styles.rows}>
            <div>
              <dt>密码</dt>
              <dd>{overview.account.username ? '已设置' : '待设置'}</dd>
            </div>
            <div>
              <dt>通行密钥</dt>
              <dd>{overview.security.activePasskeys} 个</dd>
            </div>
            <div>
              <dt>已登录设备</dt>
              <dd>{overview.security.activeSessions} 个</dd>
            </div>
          </dl>
          <Link href="/account/security">管理登录方式与设备</Link>
        </section>
      </div>
    </AccountShell>
  )
}
