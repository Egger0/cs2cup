'use client'

import styles from './ScheduleFilters.module.css'

export function TeamPicker({
  base,
  state,
  teams,
  selected,
}: {
  base: string
  state: string
  teams: { tag: string; name: string }[]
  selected: string
}) {
  return (
    <form className={styles.team} action={base} method="get">
      <input type="hidden" name="state" value={state} />
      <select
        name="team"
        aria-label="按战队筛选"
        defaultValue={selected}
        className={styles.select}
        onChange={event => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">全部战队</option>
        {teams.map(team => (
          <option key={team.tag} value={team.tag}>
            {team.tag} · {team.name}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className={styles.apply}>
          筛选
        </button>
      </noscript>
    </form>
  )
}
