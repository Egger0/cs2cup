import Link from 'next/link'
import type { ScheduleDayGroup, ScheduleEntry } from '@/lib/schedule'
import { STATUS_LABEL } from './schedule-view'
import matchStyles from './ScheduleMatch.module.css'
import styles from './ScheduleLedger.module.css'

interface ScheduleLedgerProps {
  base: string
  slug: string
  groups: ScheduleDayGroup[]
  nextEntry: ScheduleEntry | null
}

export function ScheduleLedger({ base, slug, groups, nextEntry }: ScheduleLedgerProps) {
  if (groups.length === 0) {
    return (
      <div className={styles.empty}>
        <p>当前筛选条件下没有比赛。</p>
        <Link href={`${base}?state=all`}>查看全部赛程</Link>
      </div>
    )
  }

  return (
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
              {group.entries.map(entry => (
                <ScheduleMatch
                  key={entry.match.id}
                  entry={entry}
                  isNext={entry.match.id === nextEntry?.match.id}
                  slug={slug}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ScheduleMatch({
  entry,
  isNext,
  slug,
}: {
  entry: ScheduleEntry
  isNext: boolean
  slug: string
}) {
  const completed = entry.status === 'completed'
  const aWon = completed && entry.winner?.id === entry.a?.id
  const bWon = completed && entry.winner?.id === entry.b?.id

  return (
    <Link
      href={`/tournaments/${slug}/matches/${entry.match.id}`}
      className={`${matchStyles.match} ${isNext ? matchStyles.nextMatch : ''}`}
    >
      <span className={matchStyles.when}>
        {entry.match.scheduledAt && entry.timeLabel ? (
          <time className={matchStyles.time} dateTime={entry.match.scheduledAt}>
            {entry.timeLabel}
          </time>
        ) : (
          <span className={matchStyles.time}>待定</span>
        )}
        <span className={matchStyles.matchNumber}>
          #{String(entry.match.slot + 1).padStart(2, '0')}
        </span>
      </span>

      <span className={matchStyles.fixture}>
        <span className={matchStyles.meta}>
          <span>{entry.match.roundLabel}</span>
          <span aria-hidden>·</span>
          <span>BO{entry.match.bestOf}</span>
          {isNext ? <span className={matchStyles.nextLabel}>下一场</span> : null}
        </span>

        <span className={matchStyles.teams}>
          <TeamLine
            tag={entry.a?.tag}
            name={entry.a?.name}
            score={entry.match.scoreA}
            completed={completed}
            lost={completed && !aWon}
          />
          <TeamLine
            tag={entry.b?.tag}
            name={entry.b?.name}
            score={entry.match.scoreB}
            completed={completed}
            lost={completed && !bWon}
          />
        </span>
      </span>

      <span className={matchStyles.result}>
        <span className={matchStyles.status} data-status={entry.status}>
          {STATUS_LABEL[entry.status]}
        </span>
        <span className={matchStyles.open}>
          对局详情 <span aria-hidden>→</span>
        </span>
      </span>
    </Link>
  )
}

function TeamLine({
  tag,
  name,
  score,
  completed,
  lost,
}: {
  tag: string | undefined
  name: string | undefined
  score: number | null
  completed: boolean
  lost: boolean
}) {
  return (
    <span className={`${matchStyles.teamLine} ${lost ? matchStyles.teamLost : ''}`}>
      <span className={matchStyles.teamTag}>{tag ?? 'TBD'}</span>
      <span className={matchStyles.teamName}>{name ?? '等待确定'}</span>
      {completed ? <span className={matchStyles.score}>{score ?? '—'}</span> : null}
    </span>
  )
}
