import type { Metadata } from 'next'
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
export const metadata: Metadata = { title: '赛程' }

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
  const groups = groupScheduleEntries(visibleEntries).map(group => ({
    ...group,
    label: group.label.replace(/^\d{4}年/, ''),
  }))
  const base = `/tournaments/${slug}/schedule`
  const calendarHref = `/tournaments/${encodeURIComponent(slug)}/calendar.ics${
    selectedTeam ? `?teamId=${selectedTeam.id}` : ''
  }`
  const emptyParams = new URLSearchParams({ state: 'all' })
  if (selectedTeam && teamEntries.length > 0) emptyParams.set('team', selectedTeam.tag)
  const emptyAction =
    entries.length > 0
      ? {
          href: `${base}?${emptyParams}`,
          label: selectedTeam && teamEntries.length > 0 ? '查看该队全部赛程' : '查看全部赛程',
        }
      : undefined
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
          <p title={SITE_TIME_ZONE}>
            {timeZoneLabel} ·{' '}
            <a className={styles.calendarLink} href={calendarHref} download>
              下载{selectedTeam ? '本队' : '赛事'}日历 (.ics)
            </a>
          </p>
        </div>

        <ScheduleLedger
          slug={slug}
          groups={groups}
          nextEntry={selectNextScheduleEntry(teamEntries)}
          emptyAction={emptyAction}
        />
      </div>
    </section>
  )
}
