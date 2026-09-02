import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import PasskeyLogin from './PasskeyLogin'
import styles from './login.module.css'

export const metadata: Metadata = {
  title: '赛事通行',
  description: '使用通行密钥进入你的赛事报名档案。',
  robots: { index: false, follow: false },
}

export default function ParticipantLoginPage() {
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
            <span>ENTRY PASS</span> / 赛事通行
          </p>
          <h1 id="participant-login-title">回到你的赛事</h1>
          <p className={styles.lede}>查看已经绑定的报名状态、阵容与下一场比赛。</p>
        </div>

        <p className={styles.assurances}>
          <span>01 / DEVICE LOCAL</span>
          由设备完成验证 · 本站不接收面容或指纹信息
        </p>
      </section>

      <section className={styles.passBand} aria-labelledby="passkey-action-title">
        <header className={styles.passHeader}>
          <p className={styles.serial}>PASSKEY AUTHENTICATION / NLC—01</p>
          <h2 id="passkey-action-title">由你的设备确认</h2>
          <p>系统将打开你已保存的通行密钥；无需输入账号或密码。</p>
        </header>

        <PasskeyLogin />

        <footer className={styles.passFooter}>
          <p>
            还没绑定？
            <br />
            请打开报名回执中的专属管理链接。
          </p>
          <Link href="/tournaments" className={styles.backLink}>
            <span aria-hidden="true">←</span> 返回公开赛事
          </Link>
        </footer>
      </section>
    </main>
  )
}
