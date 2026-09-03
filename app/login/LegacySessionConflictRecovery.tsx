'use client'

import { useRef, useState } from 'react'
import { publishParticipantSessionEnded } from '@/lib/participant-session-events'

import styles from './login.module.css'
import recoveryStyles from './passkey-recovery.module.css'

export default function LegacySessionConflictRecovery({
  destination,
}: {
  destination: '/admin/login' | '/login?reason=signed-out'
}) {
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')
  const inFlight = useRef(false)

  async function resetSessions() {
    if (inFlight.current) return
    inFlight.current = true
    setState('working')

    try {
      const response = await fetch('/api/participant/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (response.status !== 204) throw new Error('legacy session reset failed')
      publishParticipantSessionEnded()
      window.location.replace(destination)
    } catch {
      inFlight.current = false
      setState('failed')
    }
  }

  return (
    <div className={styles.loginControl} aria-busy={state === 'working'}>
      <button
        type="button"
        className={styles.passkeyButton}
        disabled={state === 'working'}
        aria-describedby="legacy-session-reset-status"
        onClick={() => void resetSessions()}
      >
        <span className={styles.buttonCode} aria-hidden="true">
          CLR
        </span>
        <span>{state === 'working' ? '正在安全清除旧会话…' : '清除全部旧会话'}</span>
        <span className={styles.buttonArrow} aria-hidden="true">
          ↗
        </span>
      </button>
      <div
        id="legacy-session-reset-status"
        className={recoveryStyles.status}
        role={state === 'failed' ? 'alert' : 'status'}
        aria-live={state === 'failed' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        <p>
          {state === 'failed'
            ? '暂时无法清除旧会话，请检查网络后重试。任何私人内容都不会因此开放。'
            : '此操作只结束当前设备上的访问，不会删除账号、报名或通行密钥。'}
        </p>
      </div>
    </div>
  )
}
