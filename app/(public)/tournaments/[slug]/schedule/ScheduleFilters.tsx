import Link from 'next/link'
import type { PublicTeam } from '@/lib/types'
import { STATE_LABEL, type StateFilter } from './schedule-view'
import { TeamPicker } from './TeamPicker'
import styles from './ScheduleFilters.module.css'

const STATES: StateFilter[] = ['upcoming', 'completed', 'all']

export function ScheduleFilters({
  base,
  state,
  teams,
  selectedTeam,
}: {
  base: string
  state: StateFilter
  teams: PublicTeam[]
  selectedTeam: PublicTeam | null
}) {
  const href = (next: StateFilter) => {
    const params = new URLSearchParams({ state: next })
    if (selectedTeam) params.set('team', selectedTeam.tag)
    return `${base}?${params}`
  }
  return (
    <div className={styles.filters}>
      <nav className={styles.segments} aria-label="比赛进度">
        {STATES.map(option => (
          <Link
            key={option}
            href={href(option)}
            aria-current={option === state ? 'true' : undefined}
            scroll={false}
          >
            {STATE_LABEL[option]}
          </Link>
        ))}
      </nav>
      <TeamPicker
        key={selectedTeam?.tag ?? ''}
        base={base}
        state={state}
        teams={teams.map(team => ({ tag: team.tag, name: team.name }))}
        selected={selectedTeam?.tag ?? ''}
      />
    </div>
  )
}
