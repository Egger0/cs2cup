import Image from 'next/image'
import Link from 'next/link'
import { CLUB_BRAND } from '@/lib/brand'
import { resolveSiteOrigin } from '@/lib/site-config'
import { ShareButton } from '@/components/share/ShareButton'
import { CopyTextButton } from '@/components/ui/CopyTextButton'
import type { SiteSetting } from '@/lib/types'
import styles from './SiteFooter.module.css'
import theme from '@/app/site-theme.module.css'
import { qqGroupContact } from '@/lib/qq-group'
import { QqGroupJoin } from './QqGroupJoin'
import { Icon } from '@/components/ui/Icon'

const KOOK_WIDGET_URL = 'https://kookapp.cn/api/guilds/3715592670073195/widget.json'
const KOOK_INVITE_URL = 'https://kook.vip/f5xEe8'

async function getKookWidget() {
  try {
    const response = await fetch(KOOK_WIDGET_URL, { next: { revalidate: 300 } })
    if (!response.ok) return null

    const data: unknown = await response.json()
    if (typeof data !== 'object' || !data) return null

    const { invite_link: inviteLink, online_count: onlineCount } = data as Record<string, unknown>
    const online = Number(onlineCount)
    if (typeof inviteLink !== 'string' || !Number.isSafeInteger(online) || online < 0) return null

    const inviteUrl = new URL(inviteLink)
    if (inviteUrl.protocol !== 'https:' || inviteUrl.hostname !== 'kook.vip') return null

    return { inviteUrl: inviteUrl.href, onlineCount: online }
  } catch {
    return null
  }
}

export async function SiteFooter({ setting }: { setting: SiteSetting }) {
  const kook = await getKookWidget()
  const kookLabel = kook ? `加入 KOOK 社群，${kook.onlineCount} 人在线` : '加入 KOOK 社群'
  const qqGroup = qqGroupContact(setting.contactQq)

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
            <div className={styles.community}>
              {qqGroup?.kind === 'invite' ? (
                <a
                  className={styles.chip}
                  href={qqGroup.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={qqGroup.number ? `加入 QQ 群 ${qqGroup.number}` : '加入官方 QQ 群'}
                >
                  <span className={styles.chipIcon} aria-hidden="true">
                    <Image src="/brand/qq.svg" alt="" width={20} height={20} />
                  </span>
                  <span>QQ 群</span>
                  {qqGroup.number ? <small>{qqGroup.number}</small> : null}
                </a>
              ) : qqGroup?.kind === 'number' ? (
                <QqGroupJoin number={qqGroup.number} />
              ) : null}

              <a
                className={styles.chip}
                href={kook?.inviteUrl ?? KOOK_INVITE_URL}
                target="_blank"
                rel="noreferrer"
                aria-label={kookLabel}
              >
                <span className={styles.chipIcon} aria-hidden="true">
                  <Image src="/brand/kook.svg" alt="" width={20} height={20} />
                </span>
                <span>KOOK</span>
                {kook ? <small>{kook.onlineCount} 在线</small> : null}
              </a>

              <details className={styles.douyin}>
                <summary className={styles.chip} aria-label="展开抖音关注码">
                  <span className={styles.chipIcon} aria-hidden="true">
                    <Icon name="qr" size={20} />
                  </span>
                  <span>抖音</span>
                  <small>扫码</small>
                </summary>
                <Image
                  className={styles.qrImage}
                  src="/brand/douyin-qr-display.png"
                  alt="抖音账号关注码"
                  width={112}
                  height={112}
                  unoptimized
                />
              </details>
            </div>

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
