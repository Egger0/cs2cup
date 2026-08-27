import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { SITE_TIME_ZONE } from '@/lib/datetime'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import {
  buildScheduleEntries,
  groupScheduleEntries,
  selectNextScheduleEntry,
  type ScheduleEntry,
  type ScheduleStatus,
} from '@/lib/schedule'
import styles from './schedule.module.css'

export const revalidate = 300

type StateFilter = 'upcoming' | 'completed' | 'all'

interface SchedulePageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    state?: string | string[]
    team?: string | string[]
  }>
}

const STATE_LABEL: Record<StateFilter, string> = {
  upcoming: '未完赛',
  completed: '已完赛',
  all: '全部状态',
}

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  completed: '已完赛',
  upcoming: '待开赛',
  overdue: '待更新',
  waiting: '等待对阵',
  unscheduled: '待排期',
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function readState(value: string | string[] | undefined): StateFilter {
  const state = firstValue(value)
  return state === 'completed' || state === 'all' ? state : 'upcoming'
}

function belongsToTeam(entry: ScheduleEntry, teamId: number) {
  return entry.a?.id === teamId || entry.b?.id === teamId
}

function matchesState(entry: ScheduleEntry, state: StateFilter) {
  if (state === 'all') return true
  if (state === 'completed') return entry.status === 'completed'
  return entry.status !== 'completed'
}

export default async function SchedulePage({ params, searchParams }: SchedulePageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const state = readState(query.state)
  const teamQuery = (firstValue(query.team) ?? '').trim()
  const selectedTeam = teamQuery
    ? teams.find(
        team =>
          String(team.id) === teamQuery || team.tag.toLocaleLowerCase() === teamQuery.toLocaleLowerCase(),
      ) ?? null
    : null

  const entries = buildScheduleEntries(matches, teams)
  const teamEntries = selectedTeam
    ? entries.filter(entry => belongsToTeam(entry, selectedTeam.id))
    : entries
  const nextEntry = selectNextScheduleEntry(teamEntries)
  const visibleEntries = teamEntries.filter(entry => matchesState(entry, state))
  const groups = groupScheduleEntries(visibleEntries)
  const base = `/tournaments/${slug}/schedule`
  const timeZoneLabel = SITE_TIME_ZONE === 'Asia/Shanghai' ? '北京时间' : SITE_TIME_ZONE

  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          eyebrow={`${entries.length} 场有效对局`}
          title="比赛日程"
          lede="按开赛时间排列。已过时间但尚未录入赛果的比赛会标为“待更新”，不代表正在直播。"
        />

        <form className={styles.filters} action={base} method="get">
          <label className={styles.field}>
            <span className={styles.fieldLabel}>进度</span>
            <select name="state" defaultValue={state} className={styles.select}>
              <option value="upcoming">未完赛</option>
              <option value="completed">已完赛</option>
              <option value="all">全部状态</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>战队</span>
            <select
              name="team"
              defaultValue={selectedTeam?.tag ?? ''}
              className={styles.select}
            >
              <option value="">全部战队</option>
              {teams.map(team => (
                <option key={team.id} value={team.tag}>
                  {team.tag} · {team.name}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className={styles.submit}>
            查看日程
          </button>
          <Link href={base} className={styles.reset}>
            重置
          </Link>
        </form>

        <div className={styles.summary}>
          <p>
            <strong>{visibleEntries.length}</strong> 场 · {selectedTeam?.name ?? '全部战队'} ·{' '}
            {STATE_LABEL[state]}
          </p>
          <p title={SITE_TIME_ZONE}>{timeZoneLabel}</p>
        </div>

        {groups.length > 0 ? (
          <div className={styles.ledger}>
            {groups.map((group, groupIndex) => {
              const headingId = `schedule-group-${groupIndex}`

              return (
                <section key={group.key} className={styles.dayGroup} aria-labelledby={headingId}>
                  <header className={styles.dayHead}>
                    <h2 id={headingId} className={styles.dayTitle}>
                      {group.dayKey ? (
                        <time dateTime={group.dayKey}>{group.label ?? group.dayKey}</time>
                      ) : (
                        (group.label ?? '待排期')
                      )}
                    </h2>
                    <span className={styles.dayCount}>{group.entries.length} 场</span>
                  </header>

                  <div>
                    {group.entries.map(entry => {
                      const isNext = entry.match.id === nextEntry?.match.id
                      const completed = entry.status === 'completed'
                      const aWon = completed && entry.winner?.id === entry.a?.id
                      const bWon = completed && entry.winner?.id === entry.b?.id

                      return (
                        <Link
                          key={entry.match.id}
                          href={`/tournaments/${slug}/matches/${entry.match.id}`}
                          className={`${styles.match} ${isNext ? styles.nextMatch : ''}`}
                        >
                          <span className={styles.when}>
                            {entry.match.scheduledAt && entry.timeLabel ? (
                              <time className={styles.time} dateTime={entry.match.scheduledAt}>
                                {entry.timeLabel}
                              </time>
                            ) : (
                              <span className={styles.time}>待定</span>
                            )}
                            <span className={styles.matchNumber}>
                              #{String(entry.match.slot + 1).padStart(2, '0')}
                            </span>
                          </span>

                          <span className={styles.fixture}>
                            <span className={styles.meta}>
                              <span>{entry.match.roundLabel}</span>
                              <span aria-hidden>·</span>
                              <span>BO{entry.match.bestOf}</span>
                              {isNext ? <span className={styles.nextLabel}>下一场</span> : null}
                            </span>

                            <span className={styles.teams}>
                              <span
                                className={`${styles.teamLine} ${
                                  completed && !aWon ? styles.teamLost : ''
                                }`}
                              >
                                <span className={styles.teamTag}>{entry.a?.tag ?? 'TBD'}</span>
                                <span className={styles.teamName}>{entry.a?.name ?? '等待确定'}</span>
                                {completed ? (
                                  <span className={styles.score}>{entry.match.scoreA ?? '—'}</span>
                                ) : null}
                              </span>
                              <span
                                className={`${styles.teamLine} ${
                                  completed && !bWon ? styles.teamLost : ''
                                }`}
                              >
                                <span className={styles.teamTag}>{entry.b?.tag ?? 'TBD'}</span>
                                <span className={styles.teamName}>{entry.b?.name ?? '等待确定'}</span>
                                {completed ? (
                                  <span className={styles.score}>{entry.match.scoreB ?? '—'}</span>
                                ) : null}
                              </span>
                            </span>
                          </span>

                          <span className={styles.result}>
                            <span className={styles.status} data-status={entry.status}>
                              {STATUS_LABEL[entry.status]}
                            </span>
                            <span className={styles.open}>
                              对局详情 <span aria-hidden>→</span>
                            </span>
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            <p>当前筛选条件下没有比赛。</p>
            <Link href={`${base}?state=all`}>查看全部赛程</Link>
          </div>
        )}
      </div>
    </section>
  )
}
