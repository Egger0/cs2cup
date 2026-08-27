import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Empty } from '@/components/ui'
import { MapStats } from '@/components/domain/MapStats'
import { SectionHead } from '@/components/domain/Sections'
import { indexMatches, indexTeams, isByeMatch, isCompletedMatch, resolveMatch } from '@/lib/bracket'
import { mapStats } from '@/lib/mapstats'
import { getMatchMaps, getMatches, getPublicTeams, getTournament, safely } from '@/lib/queries/public'
import styles from '@/components/domain/TeamProfile.module.css'

export const revalidate = 300

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

  const team = teams.find(entry => entry.tag.toLowerCase() === decodeURIComponent(tag).toLowerCase())
  if (!team) notFound()

  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)

  const played = matches
    .map(match => ({ ...resolveMatch(match, matchIndex, teamIndex), match }))
    .filter(entry => entry.a?.id === team.id || entry.b?.id === team.id)
    .sort((x, y) => x.match.round - y.match.round)

  const wins = played.filter(
    entry => isCompletedMatch(entry.match) && entry.match.winnerTeamId === team.id,
  ).length
  const losses = played.filter(
    entry => isCompletedMatch(entry.match) && entry.match.winnerTeamId !== team.id,
  ).length

  const maps = await safely(
    () => getMatchMaps(played.map(entry => entry.match.id)),
    [],
  )
  const stats = mapStats(maps, tournament.mapPool).filter(stat => stat.total > 0)

  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.head}>
          <div>
            <span className={styles.seed}>{team.seed ? `#${team.seed}` : '—'}</span>
            <div className={styles.tag}>{team.tag}</div>
            <h1 className={styles.name}>{team.name}</h1>
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
                      player.isSubstitute
                        ? `${styles.playerName} ${styles.sub}`
                        : styles.playerName
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
          <SectionHead eyebrow="赛程" title="打过的比赛" />
          <div className={styles.timeline}>
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
                  ) : (
                    <span className={styles.pending}>未开始</span>
                  )}
                </Link>
              )
            })}
          </div>
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
