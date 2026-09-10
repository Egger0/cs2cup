import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { accountHasWorkAccess, accountSecurityState } from '@/lib/identity/account-security-state'
import { getAuthContext } from '@/lib/identity/kernel'
import { AccountSignOut } from '../AccountSignOut'
import accountStyles from '../account.module.css'
import { InitialAccountSetup } from './InitialAccountSetup'
import { PasskeyManager } from './PasskeyManager'
import { PasswordManager } from './PasswordManager'
import { RecoveryCodeManager } from './RecoveryCodeManager'
import { SessionManager } from './SessionManager'
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
  const database = cloudflareBindings().db
  const account = await accountSecurityState(database, context)
  if (!account) redirect('/login?error=expired&redirectKey=account_security')
  const hasWorkAccess = context.session.recoveryRestricted
    ? false
    : await accountHasWorkAccess(database, account.accountId)
  const needsSetup = account.username === null

  return (
    <div className={`${accountStyles.page} ${styles.page}`}>
      <header className={accountStyles.topbar}>
        <Link href="/" className={accountStyles.brand}>
          <Image src="/brand/club-mark.svg" alt="" width={30} height={30} priority />
          <span>宁波理工电竞社</span>
        </Link>
        <nav aria-label="账号导航">
          {!context.session.recoveryRestricted ? <Link href="/account">资格与账号</Link> : null}
          {!context.session.recoveryRestricted && hasWorkAccess ? (
            <Link href="/admin">工作台</Link>
          ) : null}
          <AccountSignOut />
        </nav>
      </header>

      <main id="main">
        <div className={styles.shell}>
          <header className={styles.intro}>
            <p>ACCOUNT SECURITY / 账号安全</p>
            <h1>
              {context.session.recoveryRestricted
                ? '最后一步：设置新密码。'
                : needsSetup
                  ? '完成设置，之后随时回来。'
                  : '登录方式保持简单，也留有退路。'}
            </h1>
            <span>
              {account.username ? `@${account.username}` : 'PASSKEY ACCOUNT / 待设置用户名'}
            </span>
          </header>

          {needsSetup ? (
            <InitialAccountSetup />
          ) : (
            <>
              <PasswordManager recovery={context.session.recoveryRestricted} />
              {!context.session.recoveryRestricted ? (
                <>
                  <PasskeyManager />
                  <RecoveryCodeManager />
                  <SessionManager />
                </>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
