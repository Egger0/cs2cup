import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { formatSiteDateTime } from '@/lib/datetime'
import { participantEntryHasOwner } from '@/lib/queries/participant-passkey-challenges'
import {
  getManagedRegistration,
  type ManagedRegistrationTeam,
} from '@/lib/queries/registration-management'
import { ParticipantPasskeyClaim } from './ParticipantPasskeyClaim'
import { RegistrationManager } from './RegistrationManager'
import styles from './management.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '报名状态',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

const STATUS_LABEL = {
  pending: '等待审核',
  approved: '审核通过',
  rejected: '未通过审核',
} as const

function RegistrationSummary({ team }: { team: ManagedRegistrationTeam }) {
  return (
    <section className={styles.summary} aria-label="已提交的报名信息">
      <dl className={styles.summaryGrid}>
        <div>
          <dt>队长</dt>
          <dd>{team.captain}</dd>
        </div>
        <div>
          <dt>联系方式</dt>
          <dd>{team.contact}</dd>
        </div>
        <div>
          <dt>学院 / 分区</dt>
          <dd>{team.dept ?? '未填写'}</dd>
        </div>
      </dl>
      <div className={styles.rosterSummary}>
        <span className="readout">已提交阵容</span>
        <ul>
          {team.players.map(player => (
            <li key={player.id}>
              <span>{player.nickname}</span>
              <small>{player.isSubstitute ? '替补' : '首发'}</small>
            </li>
          ))}
        </ul>
      </div>
      {team.note ? (
        <div className={styles.note}>
          <span className="readout">备注</span>
          <p>{team.note}</p>
        </div>
      ) : null}
    </section>
  )
}

export default async function RegistrationStatusPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>
}) {
  const { slug, token } = await params
  const registration = await getManagedRegistration(slug, token)
  if (!registration) notFound()

  const deadline = registration.tournament.regDeadline
    ? formatSiteDateTime(registration.tournament.regDeadline)
    : null
  const claimed = await participantEntryHasOwner(cloudflareBindings().db, registration.team.id)
  return (
    <section className="section">
      <div className="wrap">
        <SectionHead eyebrow={registration.tournament.title} title="报名状态与阵容" />
        <section className={styles.statusPanel} aria-label="报名状态">
          <div>
            <span className={styles.status}>{STATUS_LABEL[registration.team.status]}</span>
            <h2>
              {registration.team.tag} · {registration.team.name}
            </h2>
          </div>
          <div className={styles.meta}>
            <span>{deadline ? `报名截止 ${deadline}` : '未设置报名截止时间'}</span>
          </div>
        </section>

        <ParticipantPasskeyClaim
          slug={slug}
          token={token}
          tournamentTitle={registration.tournament.title}
          teamTag={registration.team.tag}
          teamName={registration.team.name}
          statusLabel={STATUS_LABEL[registration.team.status]}
          claimed={claimed}
        />

        {registration.editable ? (
          <RegistrationManager
            slug={slug}
            token={token}
            team={registration.team}
            revision={registration.revision}
          />
        ) : (
          <div className={styles.lockedState}>
            <p className={styles.locked}>
              当前报名信息已锁定。如需更正阵容或联系方式，请联系赛事负责人。
            </p>
            <RegistrationSummary team={registration.team} />
          </div>
        )}
      </div>
    </section>
  )
}
