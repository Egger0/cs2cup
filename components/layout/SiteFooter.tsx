import Image from 'next/image'
import type { SiteSetting } from '@/lib/types'
import styles from './SiteFooter.module.css'

export function SiteFooter({ setting }: { setting: SiteSetting }) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.grid}>
          <div className={styles.identity}>
            <div className={styles.brand}>{setting.clubName}</div>
            <p>{setting.school}</p>
          </div>
          <div className={styles.contact}>
            {setting.contactQq ? (
              <p>
                QQ 群：<b>{setting.contactQq}</b>
              </p>
            ) : null}
            {setting.contactWechat && setting.contactWechat !== '无' ? (
              <p>
                负责人微信：<b>{setting.contactWechat}</b>
              </p>
            ) : null}
          </div>
          <figure className={styles.douyin}>
            <Image
              className={styles.qrImage}
              src="/brand/douyin-qr.png"
              alt="抖音账号关注码"
              width={112}
              height={112}
            />
            <figcaption>
              <strong>关注抖音</strong>
              <span>扫码关注宁波理工电竞社</span>
            </figcaption>
          </figure>
        </div>
        {setting.footerCopy ? <p className={styles.legal}>{setting.footerCopy}</p> : null}
      </div>
    </footer>
  )
}
