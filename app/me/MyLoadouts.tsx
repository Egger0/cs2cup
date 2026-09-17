import Link from 'next/link'
import { LOADOUT_MODES, findWeapon } from '@/lib/delta-loadouts'
import type { listSavedLoadouts } from '@/lib/loadout-community'
import type { LoadoutCode } from '@/lib/loadout-queries'
import styles from './me.module.css'

const STATUS = {
  pending: '审核中',
  approved: '已展示',
  rejected: '未通过',
  expired: '已失效',
} as const

export function MyLoadouts({ codes }: { codes: readonly LoadoutCode[] }) {
  if (!codes.length) return null
  return (
    <section className={styles.drafts} aria-labelledby="my-loadouts-title">
      <h2 id="my-loadouts-title">我的改枪码</h2>
      <div>
        {codes.map(code => (
          <article key={code.id} className={styles.loadout} data-status={code.status}>
            <span>
              {findWeapon(code.weapon)?.short ?? code.weapon} · {LOADOUT_MODES[code.mode]} ·{' '}
              <b>{STATUS[code.status]}</b>
            </span>
            <strong>{code.title}</strong>
            {!code.shotKey && code.status !== 'rejected' ? (
              <Link href={`/games/${code.gameSlug}/loadouts#loadout-mine`}>补传改装截图</Link>
            ) : code.status === 'approved' || code.status === 'expired' ? (
              <Link href={`/games/${code.gameSlug}/loadouts/${code.id}`}>
                复制 {code.copies} · 好用 {code.likes} · 留言 {code.comments}
              </Link>
            ) : (
              <Link href={`/games/${code.gameSlug}/loadouts#loadout-mine`}>查看投稿</Link>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export function SavedLoadouts({ items }: { items: Awaited<ReturnType<typeof listSavedLoadouts>> }) {
  if (!items.length) return null
  return (
    <section className={styles.drafts} aria-labelledby="saved-loadouts-title">
      <h2 id="saved-loadouts-title">我的收藏</h2>
      <div>
        {items.map(item => (
          <article key={item.id} className={styles.loadout} data-status={item.status}>
            <span>
              {findWeapon(item.weapon)?.short ?? item.weapon} · {LOADOUT_MODES[item.mode]}
              {item.source === 'official' ? ' · 官方精选' : ''}
              {item.status === 'expired' ? (
                <>
                  {' · '}
                  <b>已失效</b>
                </>
              ) : null}
            </span>
            <strong>{item.title}</strong>
            <Link href={`/games/${item.gameSlug}/loadouts/${item.id}`}>打开方案</Link>
          </article>
        ))}
      </div>
    </section>
  )
}
