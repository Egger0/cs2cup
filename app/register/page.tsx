import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAuthContext } from '@/lib/identity/kernel'
import { getCurrentParticipant } from '@/lib/participant-auth'
import formStyles from '../login/credential-form.module.css'
import bandStyles from '../login/pass-band.module.css'
import loginStyles from '../login/login.module.css'
import { RegisterForm } from './RegisterForm'
import styles from './register.module.css'
import {
  registrationAccountHref,
  registrationAuthHref,
  registrationSlug,
} from '@/lib/registration-navigation'
import { RegistrationJourney } from '@/components/domain/RegistrationJourney'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '创建账号',
  description: '一次填写账号信息和成员资料，创建账号时同步提交成员资格申请。',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[]; tournamentSlug?: string | string[] }>
}) {
  const [params, context, participant] = await Promise.all([
    searchParams,
    getAuthContext(),
    getCurrentParticipant(),
  ])
  const entrySlug = registrationSlug(params.tournamentSlug)
  if (context.kind === 'authenticated') {
    redirect(
      context.session.recoveryRestricted
        ? '/account/security?recovery=1'
        : registrationAccountHref(entrySlug),
    )
  }
  if (participant) redirect('/me')

  return (
    <main id="main" className={loginStyles.page}>
      <section className={loginStyles.vestibule} aria-labelledby="registration-title">
        <header className={loginStyles.brandline}>
          <Image src="/brand/club-mark.svg" alt="" width={38} height={38} loading="eager" />
          <strong>宁波理工电竞社</strong>
          <span>IDENTITY / CREATE—01</span>
        </header>
        <div className={loginStyles.hero}>
          <p className={loginStyles.eyebrow}>
            <span>YOUR ACCOUNT</span> / 你的账号
          </p>
          <h1 id="registration-title">加入宁理电竞。</h1>
          <p className={loginStyles.lede}>保存报名资料，找到并肩的队友，一起参加校园赛事。</p>
        </div>
        <p className={loginStyles.assurances}>
          <span>01 / ACCOUNT FIRST</span>
          一次注册，成员申请同步提交
        </p>
      </section>

      <section className={bandStyles.passBand} aria-labelledby="create-account-title">
        <header className={bandStyles.passHeader}>
          <p className={bandStyles.serial}>SELF REGISTRATION / NLC—01</p>
          <h2 id="create-account-title">注册账号与成员申请</h2>
          <p>填写一次，创建账号并提交成员资格审核。</p>
        </header>
        {entrySlug ? <RegistrationJourney slug={entrySlug} /> : null}
        <div className={bandStyles.loginControl}>
          <RegisterForm
            tournamentSlug={entrySlug}
            initialError={typeof params.error === 'string' ? params.error : undefined}
          />
        </div>
        <footer className={`${bandStyles.passFooter} ${styles.footer}`}>
          <Link href={registrationAuthHref('login', entrySlug)} className={formStyles.createLink}>
            已有账号？直接登录 →
          </Link>
          <Link
            href={entrySlug ? `/tournaments/${entrySlug}` : '/tournaments'}
            className={bandStyles.backLink}
          >
            <span aria-hidden="true">←</span> 先看看赛事
          </Link>
        </footer>
      </section>
    </main>
  )
}
