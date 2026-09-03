import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { accountOverview } from '@/lib/identity/account-overview'
import { getAuthContext } from '@/lib/identity/kernel'
import { AccountSignOut } from '../AccountSignOut'
import accountStyles from '../account.module.css'
import { PasskeyManager } from './PasskeyManager'
import styles from './security.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '账号与安全',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function AccountSecurityPage() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account_security')
  const overview = await accountOverview(cloudflareBindings().db, context)
  if (!overview) redirect('/login?error=expired&redirectKey=account_security')

  return (
    <main id="main" className={`${accountStyles.page} ${styles.page}`}>
      <header className={accountStyles.topbar}>
        <Link href="/" className={accountStyles.brand}>
          <Image src="/brand/club-mark.svg" alt="" width={30} height={30} priority />
          <span>宁波理工电竞社</span>
        </Link>
        <nav aria-label="账号导航">
          <Link href="/account">资格与账号</Link>
          {overview.hasWorkAccess ? <Link href="/admin">工作台</Link> : null}
          <AccountSignOut />
        </nav>
      </header>

      <div className={styles.shell}>
        <header className={styles.intro}>
          <p>ACCOUNT SECURITY / 账号安全</p>
          <h1>登录方式保持简单，也留有退路。</h1>
          <span>@{overview.account.username ?? 'legacy-account'}</span>
        </header>

        <section className={styles.section} aria-labelledby="password-title">
          <header>
            <div>
              <p>PASSWORD / 默认方式</p>
              <h2 id="password-title">账号密码</h2>
            </div>
            <span>已启用</span>
          </header>
          <p className={styles.explanation}>
            密码是默认登录凭证。本站接受易记的长密码，不要求周期性更换；请勿与其他网站共用。
          </p>
        </section>

        <PasskeyManager />

        <section className={styles.section} aria-labelledby="sessions-title">
          <header>
            <div>
              <p>SESSIONS / 已登录设备</p>
              <h2 id="sessions-title">当前会话</h2>
            </div>
            <span>{overview.security.activeSessions} 个有效状态</span>
          </header>
          <p className={styles.explanation}>
            当前使用{context.session.authMethod === 'password' ? '账号密码' : ' Passkey'}登录。
            退出会立即使这台设备上的统一会话失效。
          </p>
          <AccountSignOut />
        </section>
      </div>
    </main>
  )
}
