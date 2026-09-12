import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AccountShell } from '@/components/account/AccountShell'
import { PageMasthead } from '@/components/domain/Sections'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { accountHasWorkAccess, accountSecurityState } from '@/lib/identity/account-security-state'
import { getAuthContext } from '@/lib/identity/kernel'
import { InitialAccountSetup } from './InitialAccountSetup'
import { PasskeyManager } from './PasskeyManager'
import { PasswordManager } from './PasswordManager'
import { RecoveryCodeManager } from './RecoveryCodeManager'
import { SessionManager } from './SessionManager'
import styles from './security.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '登录与安全',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function AccountSecurityPage() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account_security')
  const database = cloudflareBindings().db
  const account = await accountSecurityState(database, context)
  if (!account) redirect('/login?error=expired&redirectKey=account_security')
  const recovery = context.session.recoveryRestricted
  const hasWorkAccess = recovery ? false : await accountHasWorkAccess(database, account.accountId)
  const needsSetup = account.username === null

  return (
    <AccountShell
      access={{ hasWorkAccess, recoveryRestricted: recovery }}
      identity={account.displayName}
      masthead={
        <PageMasthead
          code="SECURITY"
          eyebrow="账号安全"
          title="登录与安全"
          lede={
            recovery
              ? '设置一个新密码，之后就能正常使用这个账号。'
              : needsSetup
                ? '设置用户名和密码，之后随时用它登录。'
                : '管理密码、通行密钥、恢复码和已登录的设备。'
          }
          density="compact"
        />
      }
    >
      <div className={styles.shell}>
        {needsSetup ? (
          <InitialAccountSetup />
        ) : (
          <>
            <PasswordManager recovery={recovery} />
            {!recovery ? (
              <>
                <PasskeyManager />
                <RecoveryCodeManager />
                <SessionManager />
              </>
            ) : null}
          </>
        )}
      </div>
    </AccountShell>
  )
}
