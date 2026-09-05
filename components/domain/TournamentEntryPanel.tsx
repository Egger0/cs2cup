import Link from 'next/link'
import { ButtonLink } from '@/components/ui'
import { Icon } from '@/components/ui/Icon'
import { formatSiteDateTime } from '@/lib/datetime'
import { registrationAvailability } from '@/lib/registration'
import { registrationAccountHref, registrationAuthHref } from '@/lib/registration-navigation'
import type { Tournament } from '@/lib/types'
import styles from './TournamentEntryPanel.module.css'

export function TournamentEntryPanel({
  tournament,
  registration,
}: {
  tournament: Tournament
  registration: { cap: number; taken: number; open: boolean } | null
}) {
  const availability = registration
    ? registrationAvailability(tournament, registration.taken)
    : null
  const open = registration?.open && availability?.open
  const base = `/tournaments/${tournament.slug}`
  const heading = !registration
    ? '报名信息暂时无法加载'
    : open
      ? '报名参赛'
      : tournament.status === 'finished'
        ? '这一场，写进了回忆。'
        : availability?.reason === 'capacity_reached'
          ? '本届席位已满'
          : '报名状态与赛事安排'
  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <span>ENTRY / 参赛入口</span>
        <h2>{heading}</h2>
      </div>
      {registration ? (
        <div className={styles.capacity}>
          <p>
            <strong>{registration.taken}</strong>
            <span>/ {registration.cap} 席</span>
          </p>
          <progress
            value={Math.min(registration.taken, registration.cap)}
            max={registration.cap}
            aria-label={`已报名 ${registration.taken} 支战队，共 ${registration.cap} 个席位`}
          />
          <span>
            {open
              ? `还剩 ${availability.seatsLeft} 个席位 · 含待审核报名`
              : '已报名战队含待审核队伍'}
          </span>
        </div>
      ) : null}
      <dl className={styles.dates}>
        <div>
          <dt>报名截止</dt>
          <dd>{formatSiteDateTime(tournament.regDeadline ?? '') ?? '暂未公布'}</dd>
        </div>
        <div>
          <dt>赛事开场</dt>
          <dd>{formatSiteDateTime(tournament.startsAt ?? '') ?? '暂未公布'}</dd>
        </div>
      </dl>
      <p className={styles.timezone}>
        以上均为北京时间 ·{' '}
        {tournament.status === 'postponed'
          ? '赛事延期，请留意新的赛程安排'
          : '具体对局时间以赛程页为准'}
      </p>
      <ButtonLink
        href={
          open
            ? `${base}/register`
            : `${base}/${tournament.status === 'finished' ? 'results' : 'schedule'}`
        }
        variant="primary"
      >
        {open ? '组队报名' : tournament.status === 'finished' ? '回顾本届战报' : '查看比赛日程'}
        <Icon name="arrow" />
      </ButtonLink>
      <Link href="/me" className={styles.mine}>
        已经报名？管理我的赛事 <Icon name="diagonal" size={14} />
      </Link>
      {open ? (
        <details className={styles.steps}>
          <summary>报名流程与资格说明</summary>
          <ol>
            <li>
              <Link href={registrationAuthHref('register', tournament.slug)}>创建账号</Link>
              <span>用一个账号管理参赛与安全设置</span>
            </li>
            <li>
              <Link href={`${registrationAccountHref(tournament.slug)}#membership`}>
                申请成员资格
              </Link>
              <span>审核期间也能先保存报名草稿</span>
            </li>
            <li>
              <Link href={`${base}/register`}>填写战队报名</Link>
              <span>资格通过后提交，等待赛事审核</span>
            </li>
          </ol>
        </details>
      ) : null}
    </div>
  )
}
