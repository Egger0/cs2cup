import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { hasCurrentLegacyAdminSession } from '@/lib/auth'
import {
  getCurrentParticipant,
  hasConflictingLegacyParticipantSession,
} from '@/lib/participant-auth'
import { participantLoginNotice } from '@/lib/passkey-login-recovery'
import {
  isParticipantReturnPath,
  isParticipantStaffReturnPath,
  safeParticipantReturnPath,
} from '@/lib/participant-return'
import { getAuthContext } from '@/lib/identity/kernel'
import { isIdentityRedirectKey, resolveIdentityRedirect } from '@/lib/identity/redirects'
import { registrationAuthHref, registrationSlug } from '@/lib/registration-navigation'
import { RegistrationJourney } from '@/components/domain/RegistrationJourney'

import PasskeyLogin from './PasskeyLogin'
import LegacySessionConflictRecovery from './LegacySessionConflictRecovery'
import { PasswordLoginForm } from './PasswordLoginForm'
import formStyles from './credential-form.module.css'
import noticeStyles from './login-notice.module.css'
import styles from './login.module.css'

export const metadata: Metadata = {
  title: '账号登录',
  description: '使用账号密码或 Passkey 登录。',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ParticipantLoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    reason?: string | string[]
    reauth?: string | string[]
    returnTo?: string | string[]
    redirectKey?: string | string[]
    tournamentSlug?: string | string[]
    error?: string | string[]
  }>
}) {
  const params = await searchParams
  const returnTo = safeParticipantReturnPath(params.returnTo)
  const unifiedReturnTo = isParticipantReturnPath(params.returnTo) ? params.returnTo : ''
  const isStaffReturn = isParticipantStaffReturnPath(returnTo)
  const redirectKey = isIdentityRedirectKey(params.redirectKey)
    ? params.redirectKey
    : isStaffReturn
      ? 'workspaces'
      : 'account'
  const tournamentSlug = typeof params.tournamentSlug === 'string' ? params.tournamentSlug : ''
  const entrySlug = redirectKey === 'registration' ? registrationSlug(tournamentSlug) : null
  const unifiedTarget = unifiedReturnTo || resolveIdentityRedirect(redirectKey, { tournamentSlug })
  const [context, participant, adminSession, sessionConflict] = await Promise.all([
    getAuthContext(),
    getCurrentParticipant(),
    hasCurrentLegacyAdminSession(),
    hasConflictingLegacyParticipantSession(),
  ])
  if (context.kind === 'authenticated' && context.session.recoveryRestricted) {
    redirect('/account/security?recovery=1')
  }
  if (context.kind === 'authenticated' && params.reauth !== '1') redirect(unifiedTarget)
  const adminReauthentication = params.reauth === 'admin'
  const requiresLegacyReset =
    sessionConflict || adminSession || (adminReauthentication && Boolean(participant))
  if (participant && !requiresLegacyReset) redirect(returnTo)

  const notice = participantLoginNotice(requiresLegacyReset ? 'conflict' : params.reason)
  const conflictDestination = adminReauthentication
    ? '/admin/login'
    : `/login?reason=signed-out${
        unifiedReturnTo ? `&returnTo=${encodeURIComponent(unifiedReturnTo)}` : ''
      }`

  return (
    <main id="main" className={styles.page}>
      <section className={styles.vestibule} aria-labelledby="participant-login-title">
        <div className={styles.seal} aria-hidden="true">
          <Image src="/brand/club-mark.svg" alt="" width={440} height={440} loading="eager" />
        </div>

        <header className={styles.brandline}>
          <Image src="/brand/club-mark.svg" alt="" width={38} height={38} loading="eager" />
          <strong>宁波理工电竞社</strong>
          <span>IDENTITY / NLC—01</span>
        </header>

        <div className={styles.hero}>
          <p className={styles.eyebrow}>
            <span>ACCOUNT</span> / 账号登录
          </p>
          <h1 id="participant-login-title">{isStaffReturn ? '回到社团工作台' : '回到你的账号'}</h1>
          <p className={styles.lede}>
            {isStaffReturn
              ? '由设备确认身份后，系统会重新检查本届赛事工作权限。'
              : '查看资格进度、赛事报名与账号安全状态。'}
          </p>
        </div>

        <p className={styles.assurances}>
          <span>ACCOUNT / NINGLI</span>
          一个账号，管理资格、报名与赛事协作
        </p>
      </section>

      <section className={styles.passBand} aria-labelledby="passkey-action-title">
        <header className={styles.passHeader}>
          <p className={styles.serial}>ACCOUNT ACCESS / NLC—01</p>
          <h2 id="passkey-action-title">登录</h2>
          <p>登录后，继续填写报名或查看已保存的资料。</p>
          {!isStaffReturn ? (
            <Link
              href={registrationAuthHref('register', entrySlug)}
              className={formStyles.createLink}
            >
              还没有账号？创建账号 →
            </Link>
          ) : null}
        </header>

        {entrySlug ? <RegistrationJourney slug={entrySlug} /> : null}

        {notice ? (
          <aside
            className={noticeStyles.notice}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span aria-hidden="true">{notice.signal}</span>
            <div>
              <strong>{notice.title}</strong>
              <p>{notice.description}</p>
            </div>
          </aside>
        ) : null}

        <div className={styles.loginControl}>
          <PasswordLoginForm
            redirectKey={redirectKey}
            tournamentSlug={tournamentSlug}
            returnTo={unifiedReturnTo}
            initialError={typeof params.error === 'string' ? params.error : undefined}
          />
          <div className={formStyles.alternative}>
            <span>或</span>
          </div>
          {requiresLegacyReset ? (
            <LegacySessionConflictRecovery destination={conflictDestination} />
          ) : (
            <PasskeyLogin
              returnTo={returnTo}
              unifiedReturnTo={unifiedReturnTo}
              redirectKey={redirectKey}
              tournamentSlug={tournamentSlug}
            />
          )}
        </div>

        <footer className={styles.passFooter}>
          {isStaffReturn ? <p>还没有工作权限？请联系本届赛事负责人确认授权。</p> : null}
          <Link
            href={entrySlug ? `/tournaments/${entrySlug}` : '/tournaments'}
            className={styles.backLink}
          >
            <span aria-hidden="true">←</span> 返回公开赛事
          </Link>
        </footer>
      </section>
    </main>
  )
}
