import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAuthContext } from '@/lib/identity/kernel'
import { getCurrentParticipant } from '@/lib/participant-auth'
import loginStyles from '../login/login.module.css'
import { RegisterForm } from './RegisterForm'
import styles from './register.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '创建账号',
  description: '创建账号后即可登录、保存资料并申请成员资格。',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [params, context, participant] = await Promise.all([
    searchParams,
    getAuthContext(),
    getCurrentParticipant(),
  ])
  if (context.kind === 'authenticated') {
    redirect(context.session.recoveryRestricted ? '/account/security?recovery=1' : '/account')
  }
  if (participant) redirect('/me')

  return (
    <main id="main" className={loginStyles.page}>
      <section className={loginStyles.vestibule} aria-labelledby="registration-title">
        <div className={loginStyles.seal} aria-hidden="true">
          <Image src="/brand/club-mark.svg" alt="" width={440} height={440} loading="eager" />
        </div>
        <header className={loginStyles.brandline}>
          <Image src="/brand/club-mark.svg" alt="" width={38} height={38} loading="eager" />
          <strong>宁波理工电竞社</strong>
          <span>IDENTITY / CREATE—01</span>
        </header>
        <div className={loginStyles.hero}>
          <p className={loginStyles.eyebrow}>
            <span>YOUR ACCOUNT</span> / 你的账号
          </p>
          <h1 id="registration-title">先建立账号，再确认资格。</h1>
          <p className={loginStyles.lede}>
            账号会立即创建。即使审核尚未完成，你仍可登录、补充资料、绑定 Passkey 和保存报名草稿。
          </p>
        </div>
        <p className={loginStyles.assurances}>
          <span>01 / ACCOUNT FIRST</span>
          审核成员资格，不审核你的登录权
        </p>
      </section>

      <section className={loginStyles.passBand} aria-labelledby="create-account-title">
        <header className={loginStyles.passHeader}>
          <p className={loginStyles.serial}>SELF REGISTRATION / NLC—01</p>
          <h2 id="create-account-title">创建你的账号</h2>
          <p>密码是默认登录方式；创建完成后可自行添加 Passkey。</p>
        </header>
        <div className={loginStyles.loginControl}>
          <RegisterForm
            initialError={typeof params.error === 'string' ? params.error : undefined}
          />
        </div>
        <footer className={`${loginStyles.passFooter} ${styles.footer}`}>
          <p>已经有账号？</p>
          <Link href="/login" className={loginStyles.backLink}>
            <span aria-hidden="true">←</span> 返回登录
          </Link>
        </footer>
      </section>
    </main>
  )
}
