import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Empty } from '@/components/ui'
import { SITE_TIME_ZONE } from '@/lib/datetime'
import { playsHeadToHead } from '@/lib/tournament-format'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import { buildScheduleEntries, groupScheduleEntries, selectNextScheduleEntry } from '@/lib/schedule'
import { ScheduleFilters } from './ScheduleFilters'
import { ScheduleLedger } from './ScheduleLedger'
import { belongsToTeam, firstValue, matchesState, readState } from './schedule-view'
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
  if (!playsHeadToHead(tournament)) redirect(`/tournaments/${slug}/bracket`)

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

  if (entries.length === 0) {
    return (
      <section className="section">
        <div className="wrap">
          <Empty>赛程公布后会显示在这里。</Empty>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="wrap">
        <ScheduleFilters base={base} state={state} teams={teams} selectedTeam={selectedTeam} />
        <p className={styles.meta} title={SITE_TIME_ZONE}>
          {timeZoneLabel}
          <a className={styles.calendarLink} href={calendarHref} download>
            订阅{selectedTeam ? '本队' : ''}日历
          </a>
        </p>
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
