import { EventPass } from '@/components/cards/EventPass'
import { d1UtcTimestampToIso, isIsoInstant, siteDayKey } from '@/lib/datetime'
import type { ParticipantTournamentEntry } from '@/lib/queries/participant-account'
import styles from './pass-shelf.module.css'

export function PassShelf({ entries }: { entries: ParticipantTournamentEntry[] }) {
  if (!entries.length) return null
  return (
    <section className={styles.shelf} aria-labelledby="pass-shelf-title">
      <div className={styles.head}>
        <h2 id="pass-shelf-title">我的通行证</h2>
        <p>每报名一场赛事，就多一张通行证。现场签到后，票根会被撕下。</p>
      </div>
      <div className={styles.row}>
        {entries.map(entry => {
          const filed =
            d1UtcTimestampToIso(entry.team.registeredAt) ??
            (isIsoInstant(entry.team.registeredAt) ? entry.team.registeredAt : null)
          return (
            <EventPass
              key={entry.team.id}
              pass={{
                teamId: entry.team.id,
                tournamentSlug: entry.tournament.slug,
                tournamentTitle: entry.tournament.title,
                teamName: entry.team.name,
                teamTag: entry.team.tag,
                status: entry.team.status,
                registeredOn: filed ? siteDayKey(filed) : null,
                checkedIn: Boolean(entry.team.checkedInAt),
              }}
            />
          )
        })}
      </div>
    </section>
  )
}
