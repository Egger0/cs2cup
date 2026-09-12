'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { transitionTo } from '@/components/layout/view-transition'
import type { SolarData } from './system'
import styles from './SolarPanel.module.css'

const statuses: Record<string, string> = {
  registration: '报名中',
  running: '进行中',
  postponed: '延期中',
  finished: '已完赛',
  draft: '筹备中',
}
const roles = [
  ['打', '选手', '把训练变成下一场的胜利。'],
  ['说', '解说', '让每一次精彩都有回响。'],
  ['播', '导播', '把赛场送到每一个屏幕。'],
  ['做', '设计', '让我们的热爱被看见。'],
]
export function SolarPanel({
  data,
  selected,
  level,
  onZoom,
  onBack,
}: {
  data: SolarData
  selected: string | null
  level: number
  onZoom: (level: number) => void
  onBack: () => void
}) {
  const router = useRouter()
  if (!selected) return null
  const game = data.games.find(game => game.slug === selected)
  const event = data.tournaments.find(event => `event-${event.slug}` === selected)
  const events = data.tournaments.filter(event => event.gameId === game?.id)
  return (
    <aside className={styles.panel} aria-label="星体详情" data-solar-panel>
      <button type="button" className={styles.back} onClick={onBack}>
        ← 返回星系 <span>ESC</span>
      </button>
      {selected === 'club' && (
        <>
          <p className={styles.kicker}>EST. 2022 / OUR COMMON GRAVITY</p>
          <h2>
            同一份热爱，
            <br />
            四种上场方式。
          </h2>
          <div className={styles.roles}>
            {roles.map(([symbol, name, copy]) => (
              <Link key={symbol} href="/about#join">
                <strong>{symbol}</strong>
                <span>
                  {name}
                  <small>{copy}</small>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
      {game && (
        <>
          <p className={styles.kicker}>{game.nameEn ?? game.slug}</p>
          <h2 className={styles.gameTitle}>{game.name}</h2>
          <p>{game.tagline ?? game.description}</p>
          <p className={styles.facts}>
            {String(events.length).padStart(2, '0')} 届赛事 <span> / </span>
            {['轨道视角', '近地视角', '地表视角'][level]}
          </p>
          <div className={styles.zoom} aria-label="探索深度">
            {['轨道', '近地', '地表'].map((label, index) => (
              <button
                type="button"
                key={label}
                aria-pressed={index === level}
                onClick={() => onZoom(index)}
              >
                {label}
              </button>
            ))}
          </div>
          {!events.length && (
            <p>这个项目还没有办过比赛。社团有服务器、有裁判、有海报设计，缺的是发起人。</p>
          )}
          <Link
            className={styles.primary}
            href={events.length ? `/games/${game.slug}` : '/about#join'}
            onClick={event =>
              events.length && transitionTo(event, `/games/${game.slug}`, href => router.push(href))
            }
          >
            {events.length ? '进入项目主场' : '来牵头办一场'} ↗
          </Link>
          {!events.length && <Link href={`/games/${game.slug}`}>查看项目 →</Link>}
        </>
      )}
      {event && (
        <>
          <p className={styles.kicker}>
            {event.season} / 第 {event.edition} 届
          </p>
          <h2>{event.title}</h2>
          <p className={styles.facts}>
            {statuses[event.status]}
            {event.id === data.currentId ? ' / 当前赛事' : ''}
          </p>
          {event.championName && <p className={styles.champion}>冠军 / {event.championName}</p>}
          <div className={styles.eventLinks}>
            {[
              ['register', '报名'],
              ['schedule', '赛程'],
              ['bracket', '对阵'],
              ['results', '战报'],
            ].map(([path, label]) => (
              <Link href={`/tournaments/${event.slug}/${path}`} key={path}>
                {label} ↗
              </Link>
            ))}
          </div>
          {event.status === 'running' && (
            <div className={styles.bracket} aria-label="八强汇合至冠军">
              {['08', '04', '02', '01'].map(value => (
                <span key={value}>{value}</span>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  )
}
