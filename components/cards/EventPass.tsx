'use client'

import Link from 'next/link'
import { useCallback, useRef, useState, type CSSProperties } from 'react'
import { CheckInSheet } from './CheckInSheet'
import { hueOf } from './hue'
import { useTilt } from './useTilt'
import styles from './EventPass.module.css'

const STAMP = { pending: '审核中', approved: '已通过', rejected: '未通过' } as const

export interface EventPassData {
  teamId: number
  tournamentId: number
  tournamentSlug: string
  tournamentTitle: string
  teamName: string
  teamTag: string
  status: keyof typeof STAMP
  registeredOn: string | null
  checkedIn: boolean
}

export function EventPass({ pass }: { pass: EventPassData }) {
  const card = useRef<HTMLDivElement>(null)
  const [checkedIn, setCheckedIn] = useState(pass.checkedIn)
  const [fresh, setFresh] = useState(false)
  const [open, setOpen] = useState(false)
  useTilt(card, 'thumb')
  const markCheckedIn = useCallback(() => {
    setCheckedIn(true)
    setFresh(true)
  }, [])
  const canCheckIn = pass.status === 'approved' && !checkedIn
  const stub = (
    <>
      <span>ADMIT ONE TEAM</span>
      <b>{checkedIn ? '已签到' : canCheckIn ? '出示签到码' : '审核通过后可签到'}</b>
    </>
  )

  return (
    <div
      ref={card}
      className={styles.pass}
      data-status={pass.status}
      data-checked-in={checkedIn ? '' : undefined}
      data-fresh={fresh ? '' : undefined}
      style={{ '--hue': hueOf(pass.tournamentSlug) } as CSSProperties}
    >
      <div className={styles.tilt}>
        <Link
          href={`/tournaments/${pass.tournamentSlug}`}
          className={styles.sheet}
          aria-label={`${pass.tournamentTitle} 通行证，${pass.teamName}，${STAMP[pass.status]}${checkedIn ? '，已签到' : ''}`}
        >
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
            {checkedIn ? '已签到' : STAMP[pass.status]}
          </span>
          <span className={styles.glare} />
        </Link>
        {canCheckIn ? (
          <button
            type="button"
            className={styles.stub}
            aria-label={`出示 ${pass.teamTag} 的签到码`}
            onClick={() => setOpen(true)}
          >
            {stub}
          </button>
        ) : (
          <div className={styles.stub}>{stub}</div>
        )}
      </div>
      {open ? (
        <CheckInSheet
          teamId={pass.teamId}
          tournamentId={pass.tournamentId}
          teamTag={pass.teamTag}
          teamName={pass.teamName}
          onClose={() => setOpen(false)}
          onCheckedIn={markCheckedIn}
        />
      ) : null}
    </div>
  )
}
