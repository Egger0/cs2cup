'use client'

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useState } from 'react'
import { safeParticipantReturnPath } from '@/lib/participant-return'

import styles from './login.module.css'

type SupportState = 'checking' | 'supported' | 'unsupported'
type LoginState = 'idle' | 'working' | 'error'
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON']

const LOGIN_ERROR = '未完成登录，可以再次尝试。'

export default function PasskeyLogin({ returnTo = '/me' }: { returnTo?: string }) {
  const [support, setSupport] = useState<SupportState>('checking')
  const [loginState, setLoginState] = useState<LoginState>('idle')

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) setSupport(browserSupportsWebAuthn() ? 'supported' : 'unsupported')
    })
    return () => {
      active = false
    }
  }, [])

  async function authenticate() {
    if (support !== 'supported' || loginState === 'working') return

    setLoginState('working')
    try {
      const optionsResponse = await fetch('/api/participant/passkeys/authenticate/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!optionsResponse.ok) throw new Error('options request failed')

      const optionsJSON = (await optionsResponse.json()) as AuthenticationOptions
      const authentication = await startAuthentication({ optionsJSON })
      const verificationResponse = await fetch('/api/participant/passkeys/authenticate/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authentication),
      })
      if (!verificationResponse.ok) throw new Error('verification failed')

      // A full navigation picks up the participant session cookie returned by verification.
      const safeReturnTo = safeParticipantReturnPath(returnTo)
      window.location.assign(safeReturnTo)
    } catch {
      setLoginState('error')
    }
  }

  const isWorking = loginState === 'working'
  const isUnavailable = support !== 'supported'
  const buttonLabel =
    support === 'checking'
      ? '正在检查这台设备…'
      : support === 'unsupported'
        ? '当前设备暂不可用'
        : isWorking
          ? '正在等待设备确认…'
          : '使用通行密钥登录'

  return (
    <div className={styles.loginControl} aria-busy={isWorking}>
      <button
        type="button"
        className={styles.passkeyButton}
        disabled={isUnavailable || isWorking}
        onClick={authenticate}
      >
        <span className={styles.buttonCode} aria-hidden="true">
          PK
        </span>
        <span>{buttonLabel}</span>
        <span className={styles.buttonArrow} aria-hidden="true">
          ↗
        </span>
      </button>

      <div className={styles.status} aria-live="polite">
        {support === 'checking' ? <p>正在确认浏览器的通行密钥能力。</p> : null}
        {support === 'unsupported' ? (
          <p>当前浏览器无法使用通行密钥。请换用支持的浏览器或设备，或继续使用原报名管理链接。</p>
        ) : null}
        {loginState === 'error' ? (
          <p className={styles.error} role="alert">
            {LOGIN_ERROR}
          </p>
        ) : null}
        {support === 'supported' && loginState === 'idle' ? (
          <p>验证只会在系统界面中进行。</p>
        ) : null}
      </div>
    </div>
  )
}
