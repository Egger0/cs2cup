import { d1UtcTimestampToIso, formatSiteDateTime, isIsoInstant } from '@/lib/datetime'
import { participantCheckInReceipt } from '@/lib/check-in-receipt'
import type { ParticipantTournamentEntry } from '@/lib/queries/participant-account'
import styles from './dossier.module.css'

const STATUS_LABEL = {
  pending: '等待审核',
  approved: '审核通过',
  rejected: '未通过审核',
} as const

function registrationInstant(value: string) {
  return d1UtcTimestampToIso(value) ?? (isIsoInstant(value) ? value : null)
}

export function EntryDossier({
  entry,
  managementHref,
  relationship,
}: {
  entry: ParticipantTournamentEntry
  managementHref?: string
  relationship?: 'owner' | 'manager'
}) {
  const registeredAt = registrationInstant(entry.team.registeredAt)
  const registeredLabel = registeredAt ? formatSiteDateTime(registeredAt) : null
  const checkIn = participantCheckInReceipt(entry.team.status, entry.team.checkedInAt)
  const titleId = `entry-${entry.team.id}`

  return (
    <article className={styles.dossier} aria-labelledby={titleId}>
      <header className={styles.fileHeader}>
        <div>
          <p className={styles.slug}>TOURNAMENT / {entry.tournament.slug}</p>
          <h2 id={titleId}>{entry.tournament.title}</h2>
          <p className={styles.teamName}>
            <span>[{entry.team.tag}]</span> {entry.team.name}
          </p>
        </div>
        <span className={styles.status} data-status={entry.team.status}>
          <small>REVIEW</small>
          {STATUS_LABEL[entry.team.status]}
        </span>
      </header>

      <dl className={styles.facts}>
        <div>
          <dt>队长</dt>
          <dd>{entry.team.captain}</dd>
        </div>
        <div>
          <dt>院系</dt>
          <dd>{entry.team.dept ?? '未填写'}</dd>
        </div>
        <div>
          <dt>报名时间</dt>
          <dd>
            {registeredAt ? (
              <time dateTime={registeredAt}>{registeredLabel ?? entry.team.registeredAt}</time>
            ) : (
              entry.team.registeredAt
            )}
          </dd>
        </div>
        <div className={styles.checkIn} data-state={checkIn.state}>
          <dt>现场签到</dt>
          <dd>
            <span>{checkIn.label}</span>
            {checkIn.instant && checkIn.timeLabel ? (
              <time dateTime={checkIn.instant}>北京时间 · {checkIn.timeLabel}</time>
            ) : null}
          </dd>
        </div>
      </dl>

      <section className={styles.roster} aria-labelledby={`${titleId}-roster`}>
        <div className={styles.sectionLabel}>
          <h3 id={`${titleId}-roster`}>报名阵容</h3>
          <span>{entry.team.members.length} 名成员</span>
        </div>
        {entry.team.members.length ? (
          <ol>
            {entry.team.members.map(member => (
              <li key={member.id}>
                <span className={styles.order} aria-hidden="true">
                  {String(member.sortOrder).padStart(2, '0')}
                </span>
                <strong>{member.nickname}</strong>
                <span>
                  {member.isSubstitute ? '替补' : '首发'}
                  {member.role ? ` · ${member.role}` : ''}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.emptyRoster}>暂无阵容记录</p>
        )}
      </section>

      <section className={styles.private} aria-labelledby={`${titleId}-private`}>
        <div className={styles.sectionLabel}>
          <h3 id={`${titleId}-private`}>私人报名信息</h3>
          <span>仅本人可见</span>
        </div>
        <dl>
          <div>
            <dt>联系方式</dt>
            <dd>{entry.team.contact}</dd>
          </div>
          <div>
            <dt>备注</dt>
            <dd>{entry.team.note ?? '未填写'}</dd>
          </div>
        </dl>
      </section>

      <footer className={styles.fileFooter}>
        <span className={styles.footerLinks}>
          {managementHref ? (
            <a href={managementHref}>
              管理报名 <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          <a href={`/tournaments/${encodeURIComponent(entry.tournament.slug)}`}>
            查看赛事 <span aria-hidden="true">↗</span>
          </a>
        </span>
        <span>
          {relationship
            ? `账号权限 / ${relationship === 'owner' ? '所有者' : '协作者'}`
            : '旧报名资料 / 可通过原回执迁移到账号'}
        </span>
      </footer>
    </article>
  )
}
