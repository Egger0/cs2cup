'use client'

import { useEffect, useRef, useState } from 'react'
import { useSheetDrag } from '@/components/ui/useSheetDrag'
import sheet from '@/components/ui/Sheet.module.css'
import styles from './CheckInSheet.module.css'

const POLL_MS = 3000

export function CheckInSheet({
  teamId,
  tournamentId,
  teamTag,
  teamName,
  onClose,
  onCheckedIn,
}: {
  teamId: number
  tournamentId: number
  teamTag: string
  teamName: string
  onClose: () => void
  onCheckedIn: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  useSheetDrag(dialog)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    const url = `${location.origin}/admin/tournaments/${tournamentId}/check-in#team-${teamId}`
    let live = true
    import('qrcode')
      .then(qr => qr.toDataURL(url, { margin: 1, width: 560, errorCorrectionLevel: 'M' }))
      .then(data => live && setCode(data))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [teamId, tournamentId])

  useEffect(() => {
    if (done) return
    const poll = () => {
      if (document.visibilityState !== 'visible') return
      fetch(`/api/account/pass-status?teamId=${teamId}`, { cache: 'no-store' })
        .then(response => response.json() as Promise<{ ok: boolean; checkedIn?: boolean }>)
        .then(body => {
          if (!body.ok || !body.checkedIn) return
          setDone(true)
          navigator.vibrate?.([12, 60, 12])
          onCheckedIn()
          window.setTimeout(() => dialog.current?.close(), 1400)
        })
        .catch(() => {})
    }
    const timer = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(timer)
  }, [done, teamId, onCheckedIn])

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${sheet.sheet}`}
      aria-labelledby={`check-in-${teamId}`}
      onClose={onClose}
      onClick={event => {
        if (event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <div className={styles.body}>
        <p className={styles.kicker}>现场签到 · {teamTag}</p>
        <h2 id={`check-in-${teamId}`}>{teamName}</h2>
        <div className={styles.code} data-done={done ? '' : undefined}>
          {code ? (
            <img src={code} alt="签到二维码，请向工作人员出示" width={280} height={280} />
          ) : (
            <span className={styles.placeholder} aria-hidden="true" />
          )}
          {done ? <span className={styles.stamp}>已签到</span> : null}
        </div>
        <p className={styles.hint} role="status" aria-live="polite">
          {done ? '签到完成，祝比赛顺利。' : '请向工作人员出示此码。签到完成后，这里会自动更新。'}
        </p>
        <button type="button" className={styles.close} onClick={() => dialog.current?.close()}>
          关闭
        </button>
      </div>
    </dialog>
  )
}
