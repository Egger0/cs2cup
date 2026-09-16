'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import {
  LOADOUT_MODES,
  LOADOUT_STATS,
  codeSharedAt,
  findWeapon,
  formatPrice,
  shareString,
} from '@/lib/delta-loadouts'
import { siteDayKey } from '@/lib/datetime'
import type { LoadoutDecision, ReviewLoadoutCode } from '@/lib/loadout-codes'
import { photoUrl } from '@/lib/media'
import { reviewLoadoutCodeAction } from '../actions/loadouts'
import styles from '../admin.module.css'
import review from './review.module.css'

const DECISIONS = {
  pending: [
    ['approved', '通过', 'primary'],
    ['rejected', '不通过', 'danger'],
  ],
  reported: [
    ['expired', '标记失效', 'danger'],
    ['dismiss', '仍然可用', 'ghost'],
  ],
} as const

export function LoadoutReviewRow({
  code,
  kind,
}: {
  code: ReviewLoadoutCode
  kind: keyof typeof DECISIONS
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const weapon = findWeapon(code.weapon)
  const sharedAt = codeSharedAt(code.code)

  const decide = (decision: LoadoutDecision) =>
    startTransition(async () => {
      setError('')
      const result = await reviewLoadoutCodeAction(code.id, decision).catch(() => ({
        ok: false as const,
        error: '审核保存失败，请稍后重试。',
      }))
      if (result.ok) router.refresh()
      else setError(result.error)
    })

  return (
    <article className={`${styles.listRow} ${review.row}`} aria-busy={pending}>
      <a
        className={review.media}
        href={code.shotKey ? photoUrl(code.shotKey) : undefined}
        target="_blank"
        rel="noreferrer"
      >
        {code.shotKey ? (
          <img src={photoUrl(code.shotKey)} alt="改枪台截图" />
        ) : weapon?.image ? (
          <img src={weapon.image} alt="" data-weapon="" />
        ) : null}
      </a>
      <div>
        <h3 className={styles.listTitle}>
          [{weapon?.short ?? code.weapon} · {LOADOUT_MODES[code.mode]}] {code.title}
        </h3>
        <div className={styles.listMeta}>
          {code.gameName} · {code.authorName}
          {sharedAt ? ` · 分享于 ${siteDayKey(sharedAt)}` : ''}
          {code.price ? ` · ${formatPrice(code.price)}` : ''}
          {code.tags.length ? ` · ${code.tags.join(' / ')}` : ''}
          {kind === 'reported' ? ` · 复制 ${code.copies} 次 · ${code.reports} 人反馈失效` : ''}
        </div>
        {code.stats ? (
          <div className={styles.listMeta}>
            {LOADOUT_STATS.map(([key, label]) => `${label} ${code.stats![key]}`).join(' · ')}
            {code.shotKey ? '' : ' · 无截图，属性未核对'}
          </div>
        ) : null}
        {code.note ? <p className={review.note}>{code.note}</p> : null}
        <code className={styles.listMeta}>{shareString(code.weapon, code.mode, code.code)}</code>
      </div>
      <div className={styles.rowActions}>
        {DECISIONS[kind].map(([decision, label, variant]) => (
          <Button
            key={decision}
            size="mini"
            variant={variant}
            disabled={pending}
            onClick={() => decide(decision)}
          >
            {label}
          </Button>
        ))}
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </article>
  )
}
