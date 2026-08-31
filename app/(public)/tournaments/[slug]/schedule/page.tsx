import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { SITE_TIME_ZONE } from '@/lib/datetime'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import { buildScheduleEntries, groupScheduleEntries, selectNextScheduleEntry } from '@/lib/schedule'
import { ScheduleFilters } from './ScheduleFilters'
import { ScheduleLedger } from './ScheduleLedger'
import { belongsToTeam, firstValue, matchesState, readState, STATE_LABEL } from './schedule-view'
import styles from './schedule.module.css'

export const dynamic = 'force-dynamic'

interface SchedulePageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    state?: string | string[]
    team?: string | string[]
  }>
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
    ? (teams.find(
        team =>
          String(team.id) === teamQuery ||
          team.tag.toLocaleLowerCase() === teamQuery.toLocaleLowerCase(),
      ) ?? null)
    : null

  const entries = buildScheduleEntries(matches, teams)
  const teamEntries = selectedTeam
    ? entries.filter(entry => belongsToTeam(entry, selectedTeam.id))
    : entries
  const visibleEntries = teamEntries.filter(entry => matchesState(entry, state))
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
        <ScheduleFilters base={base} state={state} teams={teams} selectedTeam={selectedTeam} />

        <div className={styles.summary}>
          <p>
            <strong>{visibleEntries.length}</strong> 场 · {selectedTeam?.name ?? '全部战队'} ·{' '}
            {STATE_LABEL[state]}
          </p>
          <p title={SITE_TIME_ZONE}>{timeZoneLabel}</p>
        </div>

        <ScheduleLedger
          base={base}
          slug={slug}
          groups={groupScheduleEntries(visibleEntries)}
          nextEntry={selectNextScheduleEntry(teamEntries)}
        />
      </div>
    </section>
  )
}
