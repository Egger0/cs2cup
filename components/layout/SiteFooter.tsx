import type { SiteSetting } from '@/lib/types'
import styles from './SiteFooter.module.css'

export function SiteFooter({ setting }: { setting: SiteSetting }) {
  return (
    <footer className={styles.footer}>
      <div className="wrap">
        <div className={styles.grid}>
          <div>
            <div className={styles.brand}>{setting.clubName}</div>
            <p>{setting.school}</p>
          </div>
          <div className={styles.contact}>
            {setting.contactQq ? (
              <p>
                QQ 群:<b>{setting.contactQq}</b>
              </p>
            ) : null}
            {setting.contactWechat ? (
              <p>
                负责人微信:<b>{setting.contactWechat}</b>
              </p>
            ) : null}
          </div>
        </div>
        {setting.footerCopy ? <p className={styles.legal}>{setting.footerCopy}</p> : null}
      </div>
    </footer>
  )
}
