import Image from 'next/image'
import { Icon } from '@/components/ui/Icon'
import { qqGroupContact } from '@/lib/qq-group'
import { QqGroupJoin } from './QqGroupJoin'
import styles from './CommunityChannels.module.css'

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

export async function CommunityChannels({
  contactQq,
  className,
}: {
  contactQq: string | null
  className?: string
}) {
  const kook = await getKookWidget()
  const kookLabel = kook ? `加入 KOOK 社群，${kook.onlineCount} 人在线` : '加入 KOOK 社群'
  const qqGroup = qqGroupContact(contactQq)

  return (
    <div className={[styles.channels, className].filter(Boolean).join(' ')}>
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
          <span>加入 QQ 群</span>
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
  )
}
