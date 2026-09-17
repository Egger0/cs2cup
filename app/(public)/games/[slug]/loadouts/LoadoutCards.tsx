import Link from 'next/link'
import {
  LOADOUT_MODES,
  codeSharedAt,
  findWeapon,
  channelLabel,
  formatCount,
  formatPrice,
  shareString,
} from '@/lib/delta-loadouts'
import { siteDayKey } from '@/lib/datetime'
import type { LoadoutCode } from '@/lib/loadout-queries'
import type { LoadoutMarks } from '@/lib/loadout-community'
import { photoUrl } from '@/lib/media'
import { LoadoutCardActions } from './LoadoutCardActions'
import { LoadoutShotUpload } from './LoadoutShotUpload'
import { LoadoutStatBars } from './LoadoutStatBars'
import styles from './LoadoutCards.module.css'

const STATUS = {
  pending: '审核中',
  approved: '已展示',
  rejected: '未通过',
  expired: '已失效',
} as const

interface CardOptions {
  readonly mine?: boolean
  readonly marks?: LoadoutMarks | null
}

export function LoadoutCards({
  codes,
  ...options
}: CardOptions & { codes: readonly LoadoutCode[] }) {
  return (
    <ul className={styles.grid}>
      {codes.map(code => (
        <LoadoutCard key={code.id} code={code} {...options} />
      ))}
    </ul>
  )
}

export function LoadoutCard({
  code,
  mine = false,
  marks,
  single = false,
  preview,
}: CardOptions & { code: LoadoutCode; single?: boolean; preview?: { shot: string | null } }) {
  const Root = single ? 'article' : 'li'
  const published = !preview && (code.status === 'approved' || code.status === 'expired')
  const shot = preview ? preview.shot : code.shotKey && photoUrl(code.shotKey)
  const detail = `/games/${code.gameSlug}/loadouts/${code.id}`
  const weapon = findWeapon(code.weapon)
  const sharedAt = codeSharedAt(code.code)
  const full = shareString(code.weapon, code.mode, code.code)

  return (
    <Root
      className={styles.card}
      id={mine || single || preview ? undefined : `loadout-${code.id}`}
      data-status={code.status}
      data-single={single ? '' : undefined}
    >
      {single && !shot && !code.renderUrl && !preview ? null : (
        <figure
          className={styles.media}
          data-shot={shot ? '' : undefined}
          data-render={!shot && code.renderUrl ? '' : undefined}
          data-ghost={!shot && !code.renderUrl && weapon?.image ? '' : undefined}
        >
          {shot ? (
            <a href={shot} target="_blank" rel="noreferrer">
              <img src={shot} alt={`「${code.title}」改枪台截图`} loading="lazy" decoding="async" />
            </a>
          ) : code.renderUrl ? (
            <img
              src={code.renderUrl}
              alt={`「${code.title}」改装效果`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : weapon?.image ? (
            <>
              <img src={weapon.image} alt="" loading="lazy" decoding="async" />
              <span className={styles.ghostNote}>底枪示意 · 非改装效果</span>
            </>
          ) : (
            <span className={styles.silhouette} aria-hidden="true">
              {weapon?.short ?? (code.weapon || '?')}
            </span>
          )}
          <figcaption className={styles.overlay}>
            <span className={styles.mode} data-mode={code.mode}>
              {LOADOUT_MODES[code.mode]}
            </span>
            {code.price ? (
              <span className={styles.price}>
                <small>约</small>
                {formatPrice(code.price)}
              </span>
            ) : null}
          </figcaption>
        </figure>
      )}

      <div className={styles.body}>
        <p className={styles.weapon}>
          <span>{weapon?.short ?? code.weapon}</span>
          {weapon ? (
            <span className={styles.weaponMeta}>
              {weapon.category} · {weapon.caliber}
            </span>
          ) : null}
          {mine || code.status === 'expired' ? (
            <span className={styles.status} data-status={code.status}>
              {STATUS[code.status]}
            </span>
          ) : null}
        </p>
        {single && !preview ? null : (
          <h3 className={styles.title}>
            {published ? <Link href={detail}>{code.title}</Link> : code.title}
          </h3>
        )}
        {code.tags.length ? (
          <ul className={styles.tags} aria-label="标签">
            {code.tags.map(tag => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}

        {code.stats ? <LoadoutStatBars stats={code.stats} base={code.baseStats} /> : null}

        {code.note ? <p className={styles.note}>{code.note}</p> : null}

        <p className={styles.meta}>
          {code.source === 'official' ? (
            <>
              <b className={styles.official}>官方精选</b>
              <span>
                {code.authorName}
                {code.authorChannel ? ` · ${channelLabel(code.authorChannel)}` : ''}
              </span>
              {code.applyCount ? <span>游戏内 {formatCount(code.applyCount)} 次使用</span> : null}
            </>
          ) : mine || preview ? null : code.authorHandle ? (
            <Link href={`/players/${code.authorHandle}`}>{code.authorName}</Link>
          ) : (
            <span>{code.authorName}</span>
          )}
          {sharedAt && code.source === 'member' ? <span>分享于 {siteDayKey(sharedAt)}</span> : null}
          {code.copies ? <span>站内复制 {code.copies} 次</span> : null}
          {published && !single ? (
            <Link href={`${detail}#comments`}>
              {code.comments ? `${code.comments} 条留言` : '去留言'}
            </Link>
          ) : null}
        </p>

        {mine && code.status !== 'rejected' ? (
          <LoadoutShotUpload
            id={code.id}
            hasShot={Boolean(code.shotKey)}
            reviewed={code.status !== 'pending'}
            queued={Boolean(code.pendingShotKey)}
          />
        ) : null}

        <div className={styles.codeRow}>
          <code className={styles.code}>{full}</code>
          {preview ? null : (
            <LoadoutCardActions
              id={code.id}
              value={full}
              title={code.title}
              live={!mine && code.status === 'approved'}
              signedIn={Boolean(marks)}
              likes={code.likes}
              liked={marks?.liked.has(code.id) ?? false}
              reported={marks?.reported.has(code.id) ?? false}
            />
          )}
        </div>
      </div>
    </Root>
  )
}
