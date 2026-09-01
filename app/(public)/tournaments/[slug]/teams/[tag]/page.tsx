import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Empty } from '@/components/ui'
import { MapStats } from '@/components/domain/MapStats'
import { SectionHead } from '@/components/domain/Sections'
import { indexMatches, indexTeams, isByeMatch, isCompletedMatch, resolveMatch } from '@/lib/bracket'
import { formatSiteCompactDateTime } from '@/lib/datetime'
import { mapStats } from '@/lib/mapstats'
import {
  getMatchMaps,
  getMatches,
  getPublicTeams,
  getTournament,
  safely,
} from '@/lib/queries/public'
import styles from '@/components/domain/TeamProfile.module.css'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; tag: string }>
}): Promise<Metadata> {
  const { slug, tag } = await params
  const tournament = await safely(() => getTournament(slug), null)
  if (!tournament) return { title: '参赛战队' }

  const teams = await safely(() => getPublicTeams(tournament.id), [])
  const decoded = decodeURIComponent(tag).toLocaleLowerCase()
  const team = teams.find(entry => entry.tag.toLocaleLowerCase() === decoded)
  return { title: team ? `${team.name} · ${team.tag}` : '参赛战队' }
}

function matchTime(value: string | null) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string; tag: string }>
}) {
  const { slug, tag } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const team = teams.find(
    entry => entry.tag.toLowerCase() === decodeURIComponent(tag).toLowerCase(),
  )
  if (!team) notFound()

  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)

  const played = matches
    .map(match => ({ ...resolveMatch(match, matchIndex, teamIndex), match }))
    .filter(entry => entry.a?.id === team.id || entry.b?.id === team.id)
    .sort((x, y) => {
      const xTime = matchTime(x.match.scheduledAt)
      const yTime = matchTime(y.match.scheduledAt)
      if (xTime !== null && yTime !== null && xTime !== yTime) return xTime - yTime
      if (xTime !== null && yTime === null) return -1
      if (xTime === null && yTime !== null) return 1
      return x.match.round - y.match.round || x.match.slot - y.match.slot || x.match.id - y.match.id
    })

  const wins = played.filter(
    entry => isCompletedMatch(entry.match) && entry.match.winnerTeamId === team.id,
  ).length
  const losses = played.filter(
    entry => isCompletedMatch(entry.match) && entry.match.winnerTeamId !== team.id,
  ).length

  const maps = await safely(() => getMatchMaps(played.map(entry => entry.match.id)), [])
  const stats = mapStats(maps, tournament.mapPool).filter(stat => stat.total > 0)

  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.head}>
          <div>
            <span className={styles.seed}>{team.seed ? `#${team.seed}` : '—'}</span>
            <div className={styles.tag}>{team.tag}</div>
            <h2 className={styles.name}>{team.name}</h2>
            <div className={styles.meta}>
              队长 {team.captain}
              {team.dept ? ` · ${team.dept}` : ''}
            </div>
          </div>
          <div className={styles.record}>
            <div className={styles.recordItem}>
              <div className={styles.recordValue}>{wins}</div>
              <div className={styles.recordKey}>胜</div>
            </div>
            <div className={styles.recordItem}>
              <div className={styles.recordValue}>{losses}</div>
              <div className={styles.recordKey}>负</div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 44 }}>
          <SectionHead eyebrow="阵容" title="首发与替补" />
          {team.players.length > 0 ? (
            <div className={styles.roster}>
              {team.players.map(player => (
                <div key={player.id} className={styles.player}>
                  <div className={styles.playerRole}>
                    {player.isSubstitute ? '替补' : (player.role ?? '选手')}
                  </div>
                  <div
                    className={
                      player.isSubstitute ? `${styles.playerName} ${styles.sub}` : styles.playerName
                    }
                  >
                    {player.nickname}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>这支战队还没有登记队员</Empty>
          )}
        </div>

        <div style={{ marginTop: 44 }}>
          <SectionHead eyebrow="赛程" title="赛程与战绩" />
          <div className={styles.timeline}>
            {played.length === 0 ? <Empty>这支战队的赛程还没有公布</Empty> : null}
            {played.map(entry => {
              const isA = entry.a?.id === team.id
              const opponent = isA ? entry.b : entry.a
              const own = isA ? entry.match.scoreA : entry.match.scoreB
              const other = isA ? entry.match.scoreB : entry.match.scoreA
              const won = entry.match.winnerTeamId === team.id
              const decided = isCompletedMatch(entry.match)
              const bye = isByeMatch(entry.match)

              return (
                <Link
                  key={entry.match.id}
                  href={`/tournaments/${slug}/matches/${entry.match.id}`}
                  className={styles.game}
                >
                  <span className={styles.round}>{entry.match.roundLabel}</span>
                  <span className={styles.opponent}>
                    {bye ? '轮空，无需对手' : `vs ${opponent?.name ?? '待定'}`}
                  </span>
                  {bye ? (
                    <span className={styles.pending}>轮空晋级</span>
                  ) : decided ? (
                    <span className={`${styles.score} ${won ? styles.won : styles.lost}`}>
                      {own} : {other}
                    </span>
                  ) : entry.match.scheduledAt ? (
                    <time className={styles.pending} dateTime={entry.match.scheduledAt}>
                      {formatSiteCompactDateTime(entry.match.scheduledAt) ?? '未排期'}
                    </time>
                  ) : (
                    <span className={styles.pending}>未排期</span>
                  )}
                </Link>
              )
            })}
          </div>
          <p className={styles.scheduleLink}>
            <Link
              href={`/tournaments/${slug}/schedule?state=all&team=${encodeURIComponent(team.tag)}`}
            >
              查看本队完整赛程 →
            </Link>
            <a
              href={`/tournaments/${encodeURIComponent(slug)}/calendar.ics?teamId=${team.id}`}
              download
            >
              下载本队日历 (.ics)
            </a>
          </p>
        </div>

        {stats.length > 0 ? (
          <div style={{ marginTop: 44 }}>
            <SectionHead eyebrow="地图" title="这支队的 Ban/Pick 倾向" />
            <MapStats stats={stats} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
