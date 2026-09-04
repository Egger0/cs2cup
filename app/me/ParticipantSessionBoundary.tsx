'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import {
  PARTICIPANT_SESSION_CHANNEL,
  PARTICIPANT_SESSION_ENDED_MARKER,
  PARTICIPANT_SESSION_ENDED_MESSAGE,
  publishParticipantSessionEnded,
} from '@/lib/participant-session-events'
import { PARTICIPANT_SIGNED_OUT_LOGIN_PATH } from '@/lib/passkey-login-recovery'
import { safeParticipantReturnPath } from '@/lib/participant-return'

import pageStyles from './me.module.css'
import styles from './session-boundary.module.css'

const MAX_TIMER_DELAY = 2_147_000_000

type BoundaryMode = 'checking' | 'open' | 'signing-out' | 'sign-out-error' | 'closed'

interface SessionClock {
  sourceRemainingMs: number
  remainingAtStart: number
  wallStartedAt: number
  monotonicStartedAt: number
}

interface SessionBoundaryContextValue {
  prepareForNavigation: () => void
  requestSignOut: () => void
}

interface PrivateSessionBoundaryProps {
  children: ReactNode
  observeParticipantSession?: boolean
  returnTo?: string
  sessionEndDestination?: string
  sessionRemainingMs: number
}

const SessionBoundaryContext = createContext<SessionBoundaryContextValue | null>(null)

function isHistoryRestore() {
  return performance
    .getEntriesByType('navigation')
    .some(entry => (entry as PerformanceNavigationTiming).type === 'back_forward')
}

export function PrivateSessionBoundary({
  children,
  observeParticipantSession = false,
  returnTo = '/me',
  sessionEndDestination,
  sessionRemainingMs,
}: PrivateSessionBoundaryProps) {
  const returnPath = safeParticipantReturnPath(returnTo)
  const expiredLogin = `/login?reason=expired&returnTo=${encodeURIComponent(returnPath)}`
  const safeSessionEndDestination =
    sessionEndDestination === '/admin/login'
      ? sessionEndDestination
      : safeParticipantReturnPath(sessionEndDestination) === sessionEndDestination
        ? sessionEndDestination
        : expiredLogin
  const [mode, setMode] = useState<BoundaryMode>('checking')
  const navigationStarted = useRef(false)
  const signOutPending = useRef(false)
  const expiryTimer = useRef<number | null>(null)
  const sessionClock = useRef<SessionClock | null>(null)

  const scrub = useCallback((nextMode: Exclude<BoundaryMode, 'open'>) => {
    // Synchronously remove the private subtree before navigation or BFCache can retain it.
    flushSync(() => setMode(nextMode))
  }, [])

  const leavePrivatePage = useCallback(
    (destination: string) => {
      if (navigationStarted.current) return
      navigationStarted.current = true
      scrub('closed')
      window.location.replace(destination)
    },
    [scrub],
  )

  const expireSession = useCallback(() => {
    leavePrivatePage(safeSessionEndDestination)
  }, [leavePrivatePage, safeSessionEndDestination])

  const prepareForNavigation = useCallback(() => {
    if (!navigationStarted.current) scrub('signing-out')
  }, [scrub])

  const startSessionClock = useCallback(() => {
    if (sessionClock.current?.sourceRemainingMs === sessionRemainingMs) {
      return sessionClock.current
    }

    const monotonicStartedAt = performance.now()
    const navigation = performance.getEntriesByType('navigation').at(-1) as
      | PerformanceNavigationTiming
      | undefined
    const responseStart = navigation?.responseStart ?? 0
    const deliveryAge =
      responseStart > 0 && responseStart <= monotonicStartedAt
        ? monotonicStartedAt - responseStart
        : 0

    sessionClock.current = {
      sourceRemainingMs: sessionRemainingMs,
      remainingAtStart: Number.isSafeInteger(sessionRemainingMs)
        ? sessionRemainingMs - deliveryAge
        : 0,
      wallStartedAt: Date.now(),
      monotonicStartedAt,
    }
    return sessionClock.current
  }, [sessionRemainingMs])

  const remainingSessionTime = useCallback(() => {
    const clock = startSessionClock()
    const elapsed = Math.max(
      0,
      Date.now() - clock.wallStartedAt,
      performance.now() - clock.monotonicStartedAt,
    )
    return clock.remainingAtStart - elapsed
  }, [startSessionClock])

  const requestSignOut = useCallback(() => {
    if (signOutPending.current || navigationStarted.current) return
    signOutPending.current = true
    scrub('signing-out')

    void (async () => {
      try {
        const response = await fetch('/api/participant/session', {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        if (response.status !== 204) throw new Error('participant logout failed')
        if (navigationStarted.current) return
        publishParticipantSessionEnded()
        leavePrivatePage(PARTICIPANT_SIGNED_OUT_LOGIN_PATH)
      } catch {
        if (navigationStarted.current) return
        signOutPending.current = false
        setMode('sign-out-error')
      }
    })()
  }, [leavePrivatePage, scrub])

  useLayoutEffect(() => {
    const remaining = remainingSessionTime()
    const expired = !Number.isFinite(remaining) || remaining <= 0
    const destination = expired ? safeSessionEndDestination : isHistoryRestore() ? returnPath : null

    if (destination) {
      if (!navigationStarted.current) {
        navigationStarted.current = true
        window.location.replace(destination)
      }
      return
    }

    // The initial gate is only revealed after the session and history state pass pre-paint checks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode('open')
  }, [remainingSessionTime, returnPath, safeSessionEndDestination])

  useEffect(() => {
    const scheduleExpiryCheck = () => {
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current)
      const remaining = remainingSessionTime()
      const delay =
        Number.isFinite(remaining) && remaining > 0 ? Math.min(remaining, MAX_TIMER_DELAY) : 0
      expiryTimer.current = window.setTimeout(checkExpiry, delay)
    }
    const checkExpiry = () => {
      const remaining = remainingSessionTime()
      if (!Number.isFinite(remaining) || remaining <= 0) {
        expireSession()
      } else {
        scheduleExpiryCheck()
      }
    }
    const handleVisibility = () => {
      if (!document.hidden) checkExpiry()
    }
    const handlePageHide = () => {
      scrub('closed')
    }
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        leavePrivatePage(returnPath)
      } else {
        checkExpiry()
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PARTICIPANT_SESSION_ENDED_MARKER && event.newValue) expireSession()
    }
    const handleChannelMessage = (event: MessageEvent<unknown>) => {
      if (event.data === PARTICIPANT_SESSION_ENDED_MESSAGE) expireSession()
    }

    let channel: BroadcastChannel | null = null
    if (observeParticipantSession) {
      try {
        channel = new BroadcastChannel(PARTICIPANT_SESSION_CHANNEL)
        channel.addEventListener('message', handleChannelMessage)
      } catch {
        channel = null
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', checkExpiry)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
    if (observeParticipantSession) window.addEventListener('storage', handleStorage)
    scheduleExpiryCheck()

    return () => {
      if (expiryTimer.current !== null) window.clearTimeout(expiryTimer.current)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', checkExpiry)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
      if (observeParticipantSession) window.removeEventListener('storage', handleStorage)
      channel?.removeEventListener('message', handleChannelMessage)
      channel?.close()
    }
  }, [
    expireSession,
    leavePrivatePage,
    observeParticipantSession,
    remainingSessionTime,
    returnPath,
    scrub,
  ])

  if (mode === 'checking') {
    return (
      <SessionBoundaryContext.Provider value={{ prepareForNavigation, requestSignOut }}>
        <div className={styles.initialGate} aria-hidden="true">
          {children}
        </div>
      </SessionBoundaryContext.Provider>
    )
  }

  if (mode === 'closed') return null

  if (mode !== 'open') {
    const failed = mode === 'sign-out-error'
    return (
      <main id="main" className={pageStyles.page}>
        <section
          className={styles.safeShell}
          role={failed ? 'alert' : 'status'}
          aria-live={failed ? 'assertive' : 'polite'}
        >
          <p className={styles.code}>SESSION / {failed ? 'RETRY' : 'CLOSING'}</p>
          <span className={styles.indicator} aria-hidden="true" />
          <h1>{failed ? '我的赛事已隐藏' : '正在关闭本次访问'}</h1>
          <p>
            {failed
              ? '退出请求暂未完成，私人内容不会重新显示。可以重试，或先返回公开首页。'
              : '正在清除这台设备上的旧登录会话。'}
          </p>
          {failed ? (
            <div className={styles.actions}>
              <button type="button" onClick={requestSignOut}>
                重试安全退出
              </button>
              {/* A full navigation keeps the private archive out of the client route cache. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">返回公开首页</a>
            </div>
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <SessionBoundaryContext.Provider value={{ prepareForNavigation, requestSignOut }}>
      {children}
    </SessionBoundaryContext.Provider>
  )
}

export function ParticipantSessionBoundary(
  props: Omit<PrivateSessionBoundaryProps, 'observeParticipantSession'>,
) {
  return <PrivateSessionBoundary {...props} observeParticipantSession />
}

export function PrivateSessionActionForm({
  action,
  label,
}: {
  action: (formData: FormData) => void | Promise<void>
  label: string
}) {
  const boundary = useContext(SessionBoundaryContext)
  if (!boundary) throw new Error('PrivateSessionActionForm requires PrivateSessionBoundary')

  return (
    <form action={action} onSubmit={boundary.prepareForNavigation}>
      <button type="submit">{label}</button>
    </form>
  )
}

export function ParticipantSignOut({ label = '退出旧登录方式' }: { label?: string }) {
  const boundary = useContext(SessionBoundaryContext)
  if (!boundary) throw new Error('ParticipantSignOut requires ParticipantSessionBoundary')

  return (
    <button type="button" onClick={boundary.requestSignOut}>
      {label}
    </button>
  )
}
