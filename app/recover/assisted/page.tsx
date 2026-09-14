import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import bandStyles from '../../login/pass-band.module.css'
import loginStyles from '../../login/login.module.css'
import { AssistedRecoverForm } from './AssistedRecoverForm'

export const metadata: Metadata = {
  title: '找回账号',
  description: '使用管理员签发的一次性链接重设账号密码。',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default function AssistedRecoverPage() {
  return (
    <main id="main" className={loginStyles.page}>
      <section className={loginStyles.vestibule} aria-labelledby="assisted-recovery-title">
        <header className={loginStyles.brandline}>
          <Image src="/brand/club-mark.svg" alt="" width={38} height={38} loading="eager" />
          <strong>宁波理工电竞社</strong>
          <span>IDENTITY / RECOVER—02</span>
        </header>
        <div className={loginStyles.hero}>
          <p className={loginStyles.eyebrow}>
            <span>ASSISTED RECOVERY</span> / 人工找回
          </p>
          <h1 id="assisted-recovery-title">重新掌握账号。</h1>
          <p className={loginStyles.lede}>
            社团管理员已经核实你的身份。验证链接后只能设置新密码；完成时，所有旧设备会自动退出。
          </p>
        </div>
        <p className={loginStyles.assurances}>
          <span>01 / ONE TIME</span>每条链接只能使用一次，24 小时内有效
        </p>
      </section>
      <section className={bandStyles.passBand} aria-labelledby="assisted-recovery-form-title">
        <header className={bandStyles.passHeader}>
          <p className={bandStyles.serial}>ASSISTED RECOVERY / NLC—02</p>
          <h2 id="assisted-recovery-form-title">使用找回链接</h2>
          <p>确认是你本人在操作，再继续设置新密码。</p>
        </header>
        <div className={bandStyles.loginControl}>
          <AssistedRecoverForm />
        </div>
        <footer className={bandStyles.passFooter}>
          <Link href="/login" className={bandStyles.backLink}>
            <span aria-hidden="true">←</span> 返回登录
          </Link>
        </footer>
      </section>
    </main>
  )
}
