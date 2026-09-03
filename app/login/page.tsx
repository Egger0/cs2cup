import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentParticipant } from '@/lib/participant-auth'
import { participantLoginNotice } from '@/lib/passkey-login-recovery'
import { isParticipantStaffReturnPath, safeParticipantReturnPath } from '@/lib/participant-return'

import PasskeyLogin from './PasskeyLogin'
import noticeStyles from './login-notice.module.css'
import styles from './login.module.css'

export const metadata: Metadata = {
  title: '赛事通行',
  description: '使用通行密钥进入你的赛事报名档案。',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function ParticipantLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[]; returnTo?: string | string[] }>
}) {
  const params = await searchParams
  const returnTo = safeParticipantReturnPath(params.returnTo)
  const isStaffReturn = isParticipantStaffReturnPath(returnTo)
  const participant = await getCurrentParticipant()
  if (participant) redirect(returnTo)

  const notice = participantLoginNotice(params.reason)

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
          <h1 id="participant-login-title">{isStaffReturn ? '回到社团工作台' : '回到你的赛事'}</h1>
          <p className={styles.lede}>
            {isStaffReturn
              ? '由设备确认身份后，系统会重新检查本届赛事工作权限。'
              : '查看已经绑定的报名状态、阵容与下一场比赛。'}
          </p>
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

        <PasskeyLogin returnTo={returnTo} />

        <footer className={styles.passFooter}>
          <p>
            {isStaffReturn ? '还没有工作权限？' : '还没绑定？'}
            <br />
            {isStaffReturn ? '请联系本届赛事负责人确认授权。' : '请打开报名回执中的专属管理链接。'}
          </p>
          <Link href="/tournaments" className={styles.backLink}>
            <span aria-hidden="true">←</span> 返回公开赛事
          </Link>
        </footer>
      </section>
    </main>
  )
}
