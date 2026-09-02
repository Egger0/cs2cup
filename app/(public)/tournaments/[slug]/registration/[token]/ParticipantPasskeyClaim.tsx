'use client'

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import styles from './claim-passkey.module.css'

type SupportState = 'checking' | 'supported' | 'unsupported'
type ClaimState = 'idle' | 'working' | 'error'
type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON']

const CLAIM_ERROR = '没有完成绑定。请保留本页，再试一次。'

interface ParticipantPasskeyClaimProps {
  slug: string
  token: string
  tournamentTitle: string
  teamTag: string
  teamName: string
  statusLabel: string
  claimed: boolean
}

export function ParticipantPasskeyClaim({
  slug,
  token,
  tournamentTitle,
  teamTag,
  teamName,
  statusLabel,
  claimed,
}: ParticipantPasskeyClaimProps) {
  const [support, setSupport] = useState<SupportState>('checking')
  const [claimState, setClaimState] = useState<ClaimState>('idle')

  useEffect(() => {
    if (claimed) return
    let active = true
    Promise.resolve().then(() => {
      if (active) setSupport(browserSupportsWebAuthn() ? 'supported' : 'unsupported')
    })
    return () => {
      active = false
    }
  }, [claimed])

  async function claimPasskey() {
    if (claimed || support !== 'supported' || claimState === 'working') return

    setClaimState('working')
    try {
      const optionsResponse = await fetch('/api/participant/passkeys/claim/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ slug, token }),
      })
      if (!optionsResponse.ok) throw new Error('options request failed')

      const optionsJSON = (await optionsResponse.json()) as RegistrationOptions
      const registration = await startRegistration({ optionsJSON })
      const verificationResponse = await fetch('/api/participant/passkeys/claim/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registration),
      })
      if (!verificationResponse.ok) throw new Error('verification failed')

      // A full navigation picks up the participant session cookie returned by verification.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/me')
    } catch {
      setClaimState('error')
    }
  }

  const isWorking = claimState === 'working'
  const buttonLabel =
    support === 'checking'
      ? '正在检查这台设备…'
      : support === 'unsupported'
        ? '当前设备暂不可用'
        : isWorking
          ? '正在等待设备确认…'
          : '绑定通行密钥'

  return (
    <section className={styles.pass} aria-labelledby="passkey-claim-title">
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>报名凭证 / PASS 01</p>
          <h2 id="passkey-claim-title">把这份报名收进你的通行证</h2>
        </div>
        <span className={styles.serial} aria-hidden="true">
          ENTRY / {String(teamTag).toUpperCase()}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.action} aria-busy={isWorking}>
          {claimed ? (
            <div className={styles.complete} role="status">
              <span className={styles.stamp} aria-hidden="true">
                已归档
              </span>
              <div>
                <strong>这份报名已经绑定</strong>
                <p>现在可以从你的只读赛事档案查看它。</p>
              </div>
              <Link href="/me">前往我的赛事 ↗</Link>
            </div>
          ) : (
            <>
              <button
                type="button"
                className={styles.claimButton}
                disabled={support !== 'supported' || isWorking}
                onClick={claimPasskey}
                aria-describedby="passkey-claim-status passkey-claim-notes"
              >
                <span className={styles.keyMark} aria-hidden="true">
                  PK
                </span>
                <span>{buttonLabel}</span>
                <span aria-hidden="true">↗</span>
              </button>
              <div id="passkey-claim-status" className={styles.actionStatus} aria-live="polite">
                {support === 'checking' ? <p>正在确认浏览器的通行密钥能力。</p> : null}
                {support === 'unsupported' ? (
                  <p>当前浏览器无法使用通行密钥；原管理链接仍可继续使用。</p>
                ) : null}
                {support === 'supported' && claimState === 'idle' ? (
                  <p>绑定时会打开设备的系统验证界面。</p>
                ) : null}
                {claimState === 'error' ? (
                  <p className={styles.error} role="alert">
                    {CLAIM_ERROR}
                  </p>
                ) : null}
              </div>
            </>
          )}
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

        <div className={styles.notes} id="passkey-claim-notes">
          <p>
            <strong>设备本地验证</strong>
            系统会在这台设备上确认是你；本站不接收你的面容或指纹数据。
          </p>
          <p>
            <strong>只读赛事档案</strong>
            “我的赛事”用于查看报名；修改仍需使用这条原管理链接。
          </p>
        </div>
      </div>
    </section>
  )
}
