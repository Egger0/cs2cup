'use client'

import { useDeferredValue, useEffect, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import {
  filterTournaments,
  readTournamentFilters,
  tournamentFilterHref,
  type TournamentFilters,
} from '@/lib/tournament-discovery'
import type { Tournament } from '@/lib/types'
import { TournamentCard } from './TournamentCard'
import { useFollowedTournaments } from './useFollowedTournaments'
import styles from './TournamentExplorer.module.css'

const STATES = [
  ['all', '全部赛事'],
  ['registration', '报名中'],
  ['running', '进行中'],
  ['finished', '已结束'],
  ['postponed', '延期中'],
] as const

export function TournamentExplorer({
  tournaments,
  initial,
}: {
  tournaments: Tournament[]
  initial: TournamentFilters
}) {
  const [filters, setFilters] = useState(initial)
  const { ids } = useFollowedTournaments()
  const deferredFilters = useDeferredValue(filters)
  const visible = filterTournaments(tournaments, deferredFilters, ids)
  const games = [
    ...new Map(
      tournaments.filter(t => t.gameSlug).map(t => [t.gameSlug!, t.gameName ?? t.gameSlug!]),
    ).entries(),
  ]
  const seasons = [...new Set(tournaments.map(t => t.season))].sort().reverse()

  useEffect(() => {
    const restore = () =>
      setFilters(
        readTournamentFilters(Object.fromEntries(new URLSearchParams(window.location.search))),
      )
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  function update(patch: Partial<TournamentFilters>) {
    const next = { ...filters, ...patch }
    setFilters(next)
    window.history.replaceState(null, '', tournamentFilterHref(next))
  }

  return (
    <div className={styles.explorer} id="all-tournaments">
      <div className={styles.heading}>
        <div>
          <h2>查找赛事</h2>
        </div>
        <p>按项目、赛季或进度筛选</p>
      </div>
      <form
        action="/tournaments"
        method="get"
        className={styles.toolbar}
        onSubmit={event => {
          event.preventDefault()
          update({ q: filters.q.trim() })
        }}
      >
        <label className={styles.search}>
          <Icon name="search" />
          <input
            aria-label="搜索赛事"
            type="search"
            name="q"
            value={filters.q}
            maxLength={80}
            placeholder="搜索赛事、项目或赛季"
            onChange={event => update({ q: event.target.value })}
          />
        </label>
        <label className={styles.select}>
          <span>项目</span>
          <select
            name="game"
            value={filters.game}
            onChange={event => update({ game: event.target.value })}
          >
            <option value="">全部项目</option>
            {games.map(([slug, name]) => (
              <option key={slug} value={slug}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.select}>
          <span>赛季</span>
          <select
            name="season"
            value={filters.season}
            onChange={event => update({ season: event.target.value })}
          >
            <option value="">全部赛季</option>
            {seasons.map(season => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="status" value={filters.status} />
        {filters.followed ? <input type="hidden" name="followed" value="1" /> : null}
        <button className={styles.submit} type="submit">
          查找
        </button>
      </form>
      <div className={styles.filterRow}>
        <nav className={styles.tabs} aria-label="按赛事进度筛选">
          {STATES.map(([state, label]) => (
            <a
              key={state}
              href={tournamentFilterHref({ ...filters, status: state })}
              aria-current={filters.status === state ? 'true' : undefined}
              onClick={event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                update({ status: state })
              }}
            >
              {label}
              <span>
                {state === 'all'
                  ? tournaments.length
                  : tournaments.filter(t => t.status === state).length}
              </span>
            </a>
          ))}
        </nav>
        <button
          type="button"
          className={styles.followed}
          aria-pressed={filters.followed}
          onClick={() => update({ followed: !filters.followed })}
        >
          <Icon name="bookmark" size={16} />
          我的关注<span>{tournaments.filter(t => ids.includes(t.id)).length}</span>
        </button>
      </div>
      <div className={styles.resultLine}>
        <p role="status" aria-live="polite">
          找到 <strong>{visible.length}</strong> 场赛事{filters.q ? ` · “${filters.q}”` : ''}
        </p>
        <span>关注保存在当前浏览器</span>
      </div>
      {visible.length ? (
        <div className={styles.grid}>
          {visible.map(tournament => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <Icon name={filters.followed ? 'bookmark' : 'search'} size={28} />
          <h3>{filters.followed ? '这里，留给你关心的比赛。' : '暂时没有找到这场比赛。'}</h3>
          <p>
            {filters.followed
              ? '点击赛事上的“关注赛事”，下次回来就能快速找到它。也可以调整筛选条件。'
              : '试试赛事简称、其他项目，或清除筛选看看全部赛事。'}
          </p>
          <button type="button" onClick={() => update(readTournamentFilters({}))}>
            查看全部赛事 <Icon name="arrow" />
          </button>
        </div>
      )}
    </div>
  )
}
