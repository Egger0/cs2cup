import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAuthContext } from '@/lib/identity/kernel'
import loginStyles from '../login/login.module.css'
import { RecoverForm } from './RecoverForm'
import { registrationAuthHref, registrationSlug } from '@/lib/registration-navigation'
import { RegistrationJourney } from '@/components/domain/RegistrationJourney'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '恢复账号',
  description: '使用一次性恢复码重设账号密码。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function RecoverPage({
  searchParams,
}: {
  searchParams: Promise<{ tournamentSlug?: string | string[] }>
}) {
  const entrySlug = registrationSlug((await searchParams).tournamentSlug)
  if ((await getAuthContext()).kind === 'authenticated') redirect('/account/security')
  return (
    <main id="main" className={loginStyles.page}>
      <section className={loginStyles.vestibule} aria-labelledby="recovery-title">
        <div className={loginStyles.seal} aria-hidden="true">
          <Image src="/brand/club-mark.svg" alt="" width={440} height={440} loading="eager" />
        </div>
        <header className={loginStyles.brandline}>
          <Image src="/brand/club-mark.svg" alt="" width={38} height={38} loading="eager" />
          <strong>宁波理工电竞社</strong>
          <span>IDENTITY / RECOVER—01</span>
        </header>
        <div className={loginStyles.hero}>
          <p className={loginStyles.eyebrow}>
            <span>ACCOUNT RECOVERY</span> / 账号恢复
          </p>
          <h1 id="recovery-title">重新掌握账号。</h1>
          <p className={loginStyles.lede}>
            验证成功后只能设置新密码。完成时，所有旧设备会自动退出。
          </p>
        </div>
        <p className={loginStyles.assurances}>
          <span>01 / ONE TIME</span>每枚恢复码只能使用一次
        </p>
      </section>
      <section className={loginStyles.passBand} aria-labelledby="recovery-form-title">
        <header className={loginStyles.passHeader}>
          <p className={loginStyles.serial}>OFFLINE RECOVERY / NLC—01</p>
          <h2 id="recovery-form-title">验证恢复码</h2>
          <p>输入用户名以及之前保存的一枚恢复码。</p>
        </header>
        {entrySlug ? <RegistrationJourney slug={entrySlug} /> : null}
        <div className={loginStyles.loginControl}>
          <RecoverForm />
        </div>
        <footer className={loginStyles.passFooter}>
          <p>仍然记得密码？</p>
          <Link href={registrationAuthHref('login', entrySlug)} className={loginStyles.backLink}>
            <span aria-hidden="true">←</span> 返回登录
          </Link>
        </footer>
      </section>
    </main>
  )
}
