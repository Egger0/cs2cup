import Link from 'next/link'
import type { PublicTeam } from '@/lib/types'
import type { StateFilter } from './schedule-view'
import styles from './ScheduleFilters.module.css'

interface ScheduleFiltersProps {
  base: string
  state: StateFilter
  teams: PublicTeam[]
  selectedTeam: PublicTeam | null
}

export function ScheduleFilters({ base, state, teams, selectedTeam }: ScheduleFiltersProps) {
  return (
    <form
      key={`${state}:${selectedTeam?.id ?? 'all'}`}
      className={styles.filters}
      action={base}
      method="get"
    >
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
        <select name="team" defaultValue={selectedTeam?.tag ?? ''} className={styles.select}>
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
  )
}
