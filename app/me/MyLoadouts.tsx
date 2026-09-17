import Link from 'next/link'
import { LOADOUT_MODES, findWeapon } from '@/lib/delta-loadouts'
import type { LoadoutCode } from '@/lib/loadout-codes'
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
