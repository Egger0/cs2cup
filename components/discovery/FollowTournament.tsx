'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { useFollowedTournaments } from './useFollowedTournaments'
import styles from './FollowTournament.module.css'

export function FollowTournament({ id, title }: { id: number; title: string }) {
  const { ids, toggle } = useFollowedTournaments()
  const [error, setError] = useState(false)
  const followed = ids.includes(id)
  return (
    <div className={styles.control}>
      <button
        type="button"
        className={styles.button}
        aria-pressed={followed}
        aria-label={`${followed ? '取消关注' : '关注'} ${title}`}
        title="保存在当前浏览器，可在赛事大厅查看"
        onClick={() => setError(!toggle(id))}
      >
        <Icon name={followed ? 'check' : 'bookmark'} />
        {followed ? '已关注' : '关注赛事'}
      </button>
      {error ? (
        <span className={styles.error} role="status">
          浏览器未允许保存，请稍后重试。
        </span>
      ) : null}
    </div>
  )
}
