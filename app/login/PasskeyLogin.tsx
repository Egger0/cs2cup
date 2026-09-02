'use client'

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useRef, useState } from 'react'
import {
  participantLoginReceiptPath,
  passkeyLoginDeviceFailure,
  passkeyLoginHttpFailure,
  passkeyLoginShouldResumeSession,
  type PasskeyLoginFeedback,
} from '@/lib/passkey-login-recovery'
import { safeParticipantReturnPath } from '@/lib/participant-return'

import styles from './login.module.css'
import recoveryStyles from './passkey-recovery.module.css'

type SupportState = 'checking' | 'supported' | 'unsupported'
type LoginState = 'idle' | 'working'
type AuthenticationOptions = Parameters<typeof startAuthentication>[0]['optionsJSON']

const FAILURE_SIGNAL: Record<PasskeyLoginFeedback['code'], string> = {
  'refresh-required': 'REQUEST / EXPIRED',
  'rate-limited': 'PACE / HOLD',
  'interrupted-or-unavailable': 'DEVICE / INTERRUPTED',
  'verification-failed': 'PASS / NOT VERIFIED',
  'temporarily-unavailable': 'SERVICE / STANDBY',
}

const UNSUPPORTED_RECOVERY = {
  code: 'unsupported',
  signal: 'DEVICE / UNSUPPORTED',
  title: '这台设备还不能打开通行密钥',
  description: '请换用支持通行密钥的浏览器或设备；你的报名仍可由原管理回执查看。',
}

function RecoveryPanel({
  code,
  signal,
  title,
  description,
  receiptPath,
}: {
  code: string
  signal: string
  title: string
  description: string
  receiptPath: string | null
}) {
  return (
    <div className={recoveryStyles.recovery} data-code={code}>
      <span className={recoveryStyles.recoverySignal}>{signal}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {receiptPath ? (
        <a href={receiptPath} className={recoveryStyles.receiptReturn}>
          <span>返回原报名回执</span>
          <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </div>
  )
}

export default function PasskeyLogin({ returnTo = '/me' }: { returnTo?: string }) {
  const [support, setSupport] = useState<SupportState>('checking')
  const [loginState, setLoginState] = useState<LoginState>('idle')
  const [failure, setFailure] = useState<PasskeyLoginFeedback | null>(null)
  const loginInFlight = useRef(false)
  const safeReturnTo = safeParticipantReturnPath(returnTo)
  const receiptPath = participantLoginReceiptPath(returnTo)

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) setSupport(browserSupportsWebAuthn() ? 'supported' : 'unsupported')
    })
    return () => {
      active = false
    }
  }, [])

  function finishWithFailure(nextFailure: PasskeyLoginFeedback) {
    loginInFlight.current = false
    setFailure(nextFailure)
    setLoginState('idle')
  }

  function handleRejectedResponse(stage: 'options' | 'verification', status: number) {
    if (passkeyLoginShouldResumeSession(status)) {
      window.location.replace(safeReturnTo)
      return
    }

    finishWithFailure(passkeyLoginHttpFailure(stage, status))
  }

  async function authenticate() {
    if (support !== 'supported' || loginState === 'working' || loginInFlight.current) return

    loginInFlight.current = true
    setFailure(null)
    setLoginState('working')
    let requestStage: 'options' | 'verification' = 'options'
    try {
      const optionsResponse = await fetch('/api/participant/passkeys/authenticate/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!optionsResponse.ok) {
        handleRejectedResponse('options', optionsResponse.status)
        return
      }

      const optionsJSON = (await optionsResponse.json()) as AuthenticationOptions
      let authentication: Awaited<ReturnType<typeof startAuthentication>>
      try {
        authentication = await startAuthentication({ optionsJSON })
      } catch (error) {
        finishWithFailure(passkeyLoginDeviceFailure(error))
        return
      }

      requestStage = 'verification'
      const verificationResponse = await fetch('/api/participant/passkeys/authenticate/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authentication),
      })
      if (!verificationResponse.ok) {
        handleRejectedResponse('verification', verificationResponse.status)
        return
      }

      // A full navigation picks up the participant session cookie returned by verification.
      window.location.assign(safeReturnTo)
    } catch {
      finishWithFailure(passkeyLoginHttpFailure(requestStage, 0))
    }
  }

  function handlePrimaryAction() {
    if (failure?.action === 'reload') {
      window.location.reload()
      return
    }
    void authenticate()
  }

  const isWorking = loginState === 'working'
  const mustWait = failure?.action === 'wait'
  const isUnavailable = support !== 'supported'
  const buttonLabel =
    support === 'checking'
      ? '正在检查这台设备…'
      : support === 'unsupported'
        ? '当前设备暂不可用'
        : isWorking
          ? '正在等待设备确认…'
          : failure?.action === 'reload'
            ? '刷新登录页面'
            : mustWait
              ? '稍后重新尝试'
              : failure
                ? '重新开始设备确认'
                : '使用通行密钥登录'

  return (
    <div className={styles.loginControl} aria-busy={isWorking}>
      <button
        type="button"
        className={styles.passkeyButton}
        disabled={isUnavailable || isWorking}
        aria-describedby="passkey-login-status"
        onClick={handlePrimaryAction}
      >
        <span className={styles.buttonCode} aria-hidden="true">
          PK
        </span>
        <span>{buttonLabel}</span>
        <span className={styles.buttonArrow} aria-hidden="true">
          ↗
        </span>
      </button>

      <div
        id="passkey-login-status"
        className={recoveryStyles.status}
        role="status"
        aria-atomic="true"
      >
        {support === 'checking' ? <p>正在确认浏览器的通行密钥能力。</p> : null}
        {support === 'unsupported' ? (
          <RecoveryPanel {...UNSUPPORTED_RECOVERY} receiptPath={receiptPath} />
        ) : null}
        {support === 'supported' && failure ? (
          <RecoveryPanel
            code={failure.code}
            signal={FAILURE_SIGNAL[failure.code]}
            title={failure.title}
            description={failure.description}
            receiptPath={receiptPath}
          />
        ) : null}
        {support === 'supported' && isWorking ? (
          <p>设备确认窗口已打开，请在系统界面中继续。</p>
        ) : null}
        {support === 'supported' && loginState === 'idle' && !failure ? (
          <p>验证只会在系统界面中进行。</p>
        ) : null}
      </div>
    </div>
  )
}
