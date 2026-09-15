import Image from 'next/image'
import Link from 'next/link'
import { CLUB_BRAND } from '@/lib/brand'
import { resolveSiteOrigin } from '@/lib/site-config'
import { ShareButton } from '@/components/share/ShareButton'
import { CopyTextButton } from '@/components/ui/CopyTextButton'
import type { SiteSetting } from '@/lib/types'
import styles from './SiteFooter.module.css'
import theme from '@/app/site-theme.module.css'
import { CommunityChannels } from './CommunityChannels'

export async function SiteFooter({ setting }: { setting: SiteSetting }) {
  return (
    <footer className={`${theme.dark} ${styles.footer}`}>
      <div className={styles.inner} data-layout-container>
        <div className={styles.invitation}>
          <div>
            <span>NINGLI ESPORTS CLUB / SINCE 2022</span>
            <p>{CLUB_BRAND.tagline}</p>
          </div>
          <ShareButton
            accessTips
            share={{
              title: CLUB_BRAND.shortName,
              text: CLUB_BRAND.description,
              url: resolveSiteOrigin(),
              label: '浙大宁波理工学院 / 官方网站',
            }}
          >
            保存与分享官网
          </ShareButton>
        </div>
        <div className={styles.grid}>
          <div className={styles.identity}>
            <Link href="/" className={styles.brand}>
              <Image src="/brand/club-mark.svg" alt="" width={40} height={40} />
              {setting.clubName}
            </Link>
            <p>{setting.school}</p>
            <nav className={styles.links} aria-label="官网快捷入口">
              <Link href="/tournaments">赛事大厅</Link>
              <Link href="/me">我的赛事</Link>
              <Link href="/about#join">加入社团</Link>
              <Link href="/search">全站搜索</Link>
              <a href="/feed.xml">订阅动态 RSS</a>
            </nav>
          </div>
          <div className={styles.contact}>
            <span className={styles.communityLabel}>社群</span>
            <CommunityChannels contactQq={setting.contactQq} />

            {setting.contactWechat && setting.contactWechat !== '无' ? (
              <p className={styles.wechat}>
                负责人微信：<b>{setting.contactWechat}</b>
                <CopyTextButton value={setting.contactWechat} label="复制微信号" />
              </p>
            ) : null}
          </div>
        </div>
        <div className={styles.legal}>
          <span>{setting.footerCopy ?? `${CLUB_BRAND.englishName} · 校园电竞，始于热爱。`}</span>
          <a href="#main">回到顶部 ↑</a>
        </div>
      </div>
    </footer>
  )
}
