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
import { ThemeToggle } from './ThemeToggle'

export async function SiteFooter({ setting }: { setting: SiteSetting }) {
  return (
    <footer className={`${theme.dark} ${styles.footer}`}>
      <div className={styles.inner} data-layout-container>
        <div className={styles.grid}>
          <div className={styles.identity}>
            <Link href="/" className={styles.brand}>
              <Image src="/brand/club-mark.svg" alt="" width={28} height={28} />
              {setting.clubName}
            </Link>
            <p>{setting.school}</p>
          </div>
          <nav className={styles.links} aria-label="官网快捷入口">
            <Link href="/about">关于社团</Link>
            <Link href="/about#join">加入我们</Link>
            <Link href="/archive">往届档案</Link>
            <Link href="/guestbook">留言板</Link>
            <a href="/feed.xml">RSS</a>
            <a href="https://nbtca.space" target="_blank" rel="noreferrer">
              计算机协会 ↗
            </a>
          </nav>
          <div className={styles.contact}>
            <CommunityChannels contactQq={setting.contactQq} />
            {setting.contactWechat && setting.contactWechat !== '无' ? (
              <p>
                负责人微信 <b>{setting.contactWechat}</b>
                <CopyTextButton value={setting.contactWechat} label="复制微信号" />
              </p>
            ) : null}
          </div>
        </div>
        <div className={styles.legal}>
          <span>
            {setting.footerCopy ?? `© ${new Date().getFullYear()} ${CLUB_BRAND.shortName}`}
          </span>
          <ShareButton
            accessTips
            className={styles.share}
            share={{
              title: CLUB_BRAND.shortName,
              text: CLUB_BRAND.description,
              url: resolveSiteOrigin(),
              label: '浙大宁波理工学院 / 官方网站',
            }}
          >
            分享官网
          </ShareButton>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  )
}
