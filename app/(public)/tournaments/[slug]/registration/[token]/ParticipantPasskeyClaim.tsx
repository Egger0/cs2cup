'use client'

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useEffect, useRef, useState } from 'react'
import {
  passkeyClaimDeviceFailure,
  passkeyClaimHttpFailure,
  type PasskeyClaimFeedback,
} from '@/lib/passkey-claim-recovery'
import { publishParticipantSessionEnded } from '@/lib/participant-session-events'
import { usePasskeyRetryCooldown } from '@/lib/passkey-retry-cooldown'
import { participantEntryAddedPath } from '@/lib/participant-return'

import {
  AnonymousClaimAction,
  CurrentOwnerAction,
  OtherOwnerAction,
  OwnershipNotes,
  SignedInAttachAction,
  type AttachState,
  type ClaimState,
  type ParticipantEntryOwnershipState,
  type SupportState,
  type SwitchState,
} from './ParticipantClaimActions'
import styles from './claim-passkey.module.css'

export type { ParticipantEntryOwnershipState } from './ParticipantClaimActions'

type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON']

export interface ParticipantPasskeyClaimProps {
  teamId: number
  slug: string
  token: string
  tournamentTitle: string
  teamTag: string
  teamName: string
  statusLabel: string
  ownershipState: ParticipantEntryOwnershipState
  loginHref: string
  hasActiveParticipant: boolean
}

const TITLE: Record<ParticipantEntryOwnershipState, string> = {
  'anonymous-unclaimed': '把这份报名收进赛事通行证',
  'signed-in-unclaimed': '加入当前赛事通行证',
  'owned-by-current': '已在你的赛事通行证中',
  'owned-by-other': '这份报名已有归属',
}

export function ParticipantPasskeyClaim({
  teamId,
  slug,
  token,
  tournamentTitle,
  teamTag,
  teamName,
  statusLabel,
  ownershipState,
  loginHref,
  hasActiveParticipant,
}: ParticipantPasskeyClaimProps) {
  const [support, setSupport] = useState<SupportState>('checking')
  const [claimState, setClaimState] = useState<ClaimState>('idle')
  const [claimFailure, setClaimFailure] = useState<PasskeyClaimFeedback | null>(null)
  const [attachState, setAttachState] = useState<AttachState>('idle')
  const [switchState, setSwitchState] = useState<SwitchState>('idle')
  const [attachConflict, setAttachConflict] = useState(false)
  const retryCooldown = usePasskeyRetryCooldown(() => {
    setClaimFailure(current => (current?.action === 'wait' ? null : current))
    setClaimState(current => (current === 'error' ? 'idle' : current))
  })
  const attachButton = useRef<HTMLButtonElement>(null)
  const previousAttachState = useRef(attachState)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const claimInFlight = useRef(false)
  const switchButton = useRef<HTMLButtonElement>(null)
  const switchInFlight = useRef(false)
  const visibleOwnership = attachConflict ? 'owned-by-other' : ownershipState

  useEffect(() => {
    if (ownershipState !== 'anonymous-unclaimed') return
    let active = true
    Promise.resolve().then(() => {
      if (active) setSupport(browserSupportsWebAuthn() ? 'supported' : 'unsupported')
    })
    return () => {
      active = false
    }
  }, [ownershipState])

  useEffect(() => {
    if (attachState === 'confirming') confirmButton.current?.focus()
  }, [attachState])

  useEffect(() => {
    const previous = previousAttachState.current
    previousAttachState.current = attachState
    if (previous === 'confirming' && attachState === 'idle') attachButton.current?.focus()
    if (previous === 'working' && attachState === 'error') attachButton.current?.focus()
  }, [attachState])

  useEffect(() => {
    if (attachConflict) switchButton.current?.focus()
  }, [attachConflict])

  useEffect(() => {
    function refreshRestoredPage(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload()
    }
    window.addEventListener('pageshow', refreshRestoredPage)
    return () => window.removeEventListener('pageshow', refreshRestoredPage)
  }, [])

  function finishClaimFailure(failure: PasskeyClaimFeedback, retryAfter: string | null = null) {
    claimInFlight.current = false
    setClaimFailure(failure)
    if (failure.action === 'wait') retryCooldown.startRetryCooldown(retryAfter)
    else retryCooldown.clearRetryCooldown()
    setClaimState('error')
  }

  async function claimPasskey() {
    if (
      visibleOwnership !== 'anonymous-unclaimed' ||
      support !== 'supported' ||
      claimState === 'working' ||
      retryCooldown.retryAfterSeconds !== null ||
      claimInFlight.current
    )
      return

    claimInFlight.current = true
    setClaimFailure(null)
    retryCooldown.clearRetryCooldown()
    setClaimState('working')
    let requestStage: 'options' | 'verification' = 'options'
    try {
      const optionsResponse = await fetch('/api/participant/passkeys/claim/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, token }),
      })
      if (optionsResponse.status === 409) {
        window.location.reload()
        return
      }
      if (!optionsResponse.ok) {
        const failure = passkeyClaimHttpFailure('options', optionsResponse.status)
        finishClaimFailure(
          failure,
          failure.action === 'wait' ? optionsResponse.headers.get('Retry-After') : null,
        )
        return
      }

      const optionsJSON = (await optionsResponse.json()) as RegistrationOptions
      let registration: Awaited<ReturnType<typeof startRegistration>>
      try {
        registration = await startRegistration({ optionsJSON })
      } catch (error) {
        finishClaimFailure(passkeyClaimDeviceFailure(error))
        return
      }

      requestStage = 'verification'
      const verificationResponse = await fetch('/api/participant/passkeys/claim/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(registration),
      })
      if (verificationResponse.status === 409) {
        window.location.reload()
        return
      }
      if (!verificationResponse.ok) {
        finishClaimFailure(passkeyClaimHttpFailure('verification', verificationResponse.status))
        return
      }

      // The verification response establishes the participant session cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/me')
    } catch {
      finishClaimFailure(passkeyClaimHttpFailure(requestStage, 0))
    }
  }

  function handleClaimAction() {
    if (claimFailure?.action === 'reload') {
      window.location.reload()
      return
    }
    void claimPasskey()
  }

  async function attachEntry() {
    if (visibleOwnership !== 'signed-in-unclaimed' || attachState === 'working') return
    setAttachState('working')
    try {
      const response = await fetch('/api/participant/entries/attach', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, managementToken: token }),
      })
      if (response.status === 401) {
        const separator = loginHref.includes('?') ? '&' : '?'
        // A full navigation applies the expired-session cookie deletion before login renders.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(`${loginHref}${separator}reason=expired`)
        return
      }
      if (response.status === 409) {
        setAttachConflict(true)
        setAttachState('idle')
        return
      }
      if (response.status !== 204) throw new Error('attach request failed')

      // A full navigation reads the newly attached entry from the server.
      window.location.assign(participantEntryAddedPath(teamId) ?? '/me')
    } catch {
      setAttachState('error')
    }
  }

  async function switchParticipant() {
    if (switchState === 'working' || switchInFlight.current) return
    switchInFlight.current = true
    setSwitchState('working')
    try {
      const response = await fetch('/api/participant/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (response.status !== 204) throw new Error('participant logout failed')

      publishParticipantSessionEnded()
      // A full navigation applies the cleared session cookie before login renders.
      window.location.assign(loginHref)
    } catch {
      switchInFlight.current = false
      setSwitchState('error')
    }
  }

  const isWorking =
    claimState === 'working' || attachState === 'working' || switchState === 'working'

  return (
    <section className={styles.pass} aria-labelledby="passkey-claim-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>报名凭证 / PASS 01</p>
          <h2 id="passkey-claim-title">{TITLE[visibleOwnership]}</h2>
        </div>
        <span className={styles.serial} aria-hidden="true">
          ENTRY / {String(teamTag).toUpperCase()}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.action} aria-busy={isWorking}>
          {visibleOwnership === 'anonymous-unclaimed' ? (
            <AnonymousClaimAction
              support={support}
              claimState={claimState}
              failure={claimFailure}
              retryDelayLabel={retryCooldown.retryDelayLabel}
              loginHref={loginHref}
              onCreate={handleClaimAction}
            />
          ) : null}
          {visibleOwnership === 'signed-in-unclaimed' ? (
            <SignedInAttachAction
              attachState={attachState}
              switchState={switchState}
              teamTag={teamTag}
              teamName={teamName}
              attachButton={attachButton}
              confirmButton={confirmButton}
              onArm={() => setAttachState('confirming')}
              onCancel={() => setAttachState('idle')}
              onConfirm={attachEntry}
              onSwitch={switchParticipant}
            />
          ) : null}
          {visibleOwnership === 'owned-by-current' ? <CurrentOwnerAction /> : null}
          {visibleOwnership === 'owned-by-other' ? (
            <OtherOwnerAction
              conflict={attachConflict}
              hasActiveParticipant={hasActiveParticipant}
              loginHref={loginHref}
              switchState={switchState}
              switchButton={switchButton}
              onSwitch={switchParticipant}
            />
          ) : null}
        </div>

        <dl className={styles.facts}>
          <div>
            <dt>赛事</dt>
            <dd>{tournamentTitle}</dd>
          </div>
          <div>
            <dt>战队</dt>
            <dd>
              {teamTag} · {teamName}
            </dd>
          </div>
          <div>
            <dt>审核状态</dt>
            <dd>{statusLabel}</dd>
          </div>
        </dl>

        <OwnershipNotes state={visibleOwnership} />
      </div>
    </section>
  )
}
