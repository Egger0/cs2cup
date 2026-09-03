import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { accountOverview } from '@/lib/identity/account-overview'
import { getAuthContext } from '@/lib/identity/kernel'
import { AccountSignOut } from './AccountSignOut'
import { MembershipPanel } from './MembershipPanel'
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
  searchParams: Promise<{ welcome?: string | string[] }>
}) {
  const [params, context] = await Promise.all([searchParams, getAuthContext()])
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account')
  const database = cloudflareBindings().db
  const clock = await database
    .prepare("SELECT unixepoch('now') * 1000 AS now")
    .bind()
    .first<{ now: number }>()
  const now = clock?.now ?? context.session.lastSeenAt
  const overview = await accountOverview(database, context, now)
  if (!overview) redirect('/login?error=expired')

  return (
    <main id="main" className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.brand}>
          <Image src="/brand/club-mark.svg" alt="" width={30} height={30} priority />
          <span>宁波理工电竞社</span>
        </Link>
        <nav aria-label="账号导航">
          {overview.hasWorkAccess ? <Link href="/admin">工作台</Link> : null}
          <Link href="/account/security">账号与安全</Link>
          <AccountSignOut />
        </nav>
      </header>

      <div className={styles.shell}>
        {params.welcome === '1' ? (
          <aside className={styles.welcome} role="status">
            <strong>账号已创建</strong>
            <p>你已经登录。接下来可以申请成员资格；等待期间账号会保持可用。</p>
          </aside>
        ) : null}

        <section className={styles.intro}>
          <div>
            <p>ACCOUNT / 账号</p>
            <h1>{overview.account.displayName}</h1>
            <span>@{overview.account.username ?? 'legacy-account'}</span>
          </div>
          <aside>
            <small>当前会话</small>
            <strong>{context.session.authMethod === 'password' ? '账号密码' : 'Passkey'}</strong>
            <span>{overview.security.activeSessions} 个有效登录状态</span>
          </aside>
        </section>

        <div className={styles.grid}>
          <MembershipPanel membership={overview.membership} now={now} />
          <section className={styles.security} aria-labelledby="security-title">
            <p>SECURITY / 登录方式</p>
            <h2 id="security-title">账号与安全</h2>
            <dl>
              <div>
                <dt>密码</dt>
                <dd>{overview.account.username ? '已设置' : '待迁移'}</dd>
              </div>
              <div>
                <dt>Passkey</dt>
                <dd>{overview.security.activePasskeys} 个</dd>
              </div>
              <div>
                <dt>已登录设备</dt>
                <dd>{overview.security.activeSessions} 个</dd>
              </div>
            </dl>
            <Link href="/account/security">管理登录方式与设备 ↗</Link>
          </section>
        </div>
      </div>
    </main>
  )
}
