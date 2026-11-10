'use client'

import Link from 'next/link'
import { useRef, type CSSProperties } from 'react'
import { hueOf } from './hue'
import { useTilt } from './useTilt'
import styles from './EventPass.module.css'

const STAMP = { pending: '审核中', approved: '已通过', rejected: '未通过' } as const

export interface EventPassData {
  teamId: number
  tournamentSlug: string
  tournamentTitle: string
  teamName: string
  teamTag: string
  status: keyof typeof STAMP
  registeredOn: string | null
  checkedIn: boolean
}

export function EventPass({ pass }: { pass: EventPassData }) {
  const card = useRef<HTMLAnchorElement>(null)
  useTilt(card, 'thumb')
  return (
    <Link
      ref={card}
      href={`/tournaments/${pass.tournamentSlug}`}
      className={styles.pass}
      data-status={pass.status}
      data-checked-in={pass.checkedIn ? '' : undefined}
      style={
        {
          '--hue': hueOf(pass.tournamentSlug),
        } as CSSProperties
      }
      aria-label={`${pass.tournamentTitle} 通行证，${pass.teamName}，${STAMP[pass.status]}${pass.checkedIn ? '，已签到' : ''}`}
    >
      <div className={styles.tilt}>
        <div className={styles.sheet}>
          <span className={styles.slot} aria-hidden="true" />
          <header className={styles.top}>
            <span>NINGLI CUP PASS</span>
            <span>№ {String(pass.teamId).padStart(5, '0')}</span>
          </header>
          <p className={styles.word}>{pass.tournamentTitle}</p>
          <div className={styles.holder}>
            <strong>{pass.teamName}</strong>
            <span className={styles.tag}>{pass.teamTag}</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>ENTRY</dt>
              <dd>战队报名</dd>
            </div>
            <div>
              <dt>FILED</dt>
              <dd>{pass.registeredOn ?? '—'}</dd>
            </div>
          </dl>
          <span className={styles.stamp} aria-hidden="true">
            {STAMP[pass.status]}
          </span>
          <div className={styles.glare} />
        </div>
        <div className={styles.stub}>
          <span>ADMIT ONE TEAM</span>
          <b>{pass.checkedIn ? '已签到' : '现场出示签到'}</b>
        </div>
      </div>
    </Link>
  )
}
