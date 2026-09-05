'use client'

import { useDeferredValue, useState } from 'react'
import { TeamGrid } from '@/components/domain/TeamGrid'
import { Icon } from '@/components/ui/Icon'
import type { PublicTeam } from '@/lib/types'
import styles from './TeamExplorer.module.css'

export function TeamExplorer({ teams, slug }: { teams: PublicTeam[]; slug: string }) {
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(query).normalize('NFKC').toLocaleLowerCase().trim()
  const visible = teams.filter(team =>
    [team.name, team.tag, team.captain, team.dept, ...team.players.map(player => player.nickname)]
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .includes(needle),
  )
  if (!teams.length) return <TeamGrid teams={teams} slug={slug} />
  return (
    <div>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Icon name="search" />
          <input
            aria-label="搜索战队或队员"
            type="search"
            value={query}
            maxLength={80}
            placeholder="战队名称、TAG、学院或队员昵称"
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <p role="status">
          {visible.length} / {teams.length} 支战队
        </p>
      </div>
      {visible.length ? (
        <TeamGrid teams={visible} slug={slug} />
      ) : (
        <div className={styles.empty}>
          <h3>暂时没找到这支战队。</h3>
          <p>可以试试 TAG、队长或队员昵称。</p>
          <button type="button" onClick={() => setQuery('')}>
            查看全部战队
          </button>
        </div>
      )}
    </div>
  )
}
