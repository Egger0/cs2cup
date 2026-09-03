'use client'

import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser'
import { useEffect, useRef, useState } from 'react'
import {
  participantLoginReceiptPath,
  passkeyLoginDeviceFailure,
  passkeyLoginHttpFailure,
  passkeyLoginShouldResumeSession,
  replaceParticipantLoginHistory,
  type PasskeyLoginFeedback,
} from '@/lib/passkey-login-recovery'
import { usePasskeyRetryCooldown } from '@/lib/passkey-retry-cooldown'

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

const PENDING_CLIENT_RECOVERY = {
  code: 'client-required',
  signal: 'BROWSER / CLIENT',
  title: '浏览器功能尚未就绪',
  description:
    '通行密钥登录需要 JavaScript。若此提示持续，请启用页面脚本、检查网络后刷新；报名和通行密钥不会改变。',
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

export default function PasskeyLogin({
  returnTo = '/account',
  redirectKey = 'account',
  tournamentSlug = '',
}: {
  returnTo?: string
  redirectKey?: string
  tournamentSlug?: string
}) {
  const [support, setSupport] = useState<SupportState>('checking')
  const [loginState, setLoginState] = useState<LoginState>('idle')
  const [failure, setFailure] = useState<PasskeyLoginFeedback | null>(null)
  const retryCooldown = usePasskeyRetryCooldown(() => {
    setFailure(current => (current?.action === 'wait' ? null : current))
  })
  const loginInFlight = useRef(false)
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

  function finishWithFailure(nextFailure: PasskeyLoginFeedback, retryAfter: string | null = null) {
    loginInFlight.current = false
    setFailure(nextFailure)
    if (nextFailure.action === 'wait') {
      retryCooldown.startRetryCooldown(retryAfter)
    } else {
      retryCooldown.clearRetryCooldown()
    }
    setLoginState('idle')
  }

  function handleRejectedResponse(stage: 'options' | 'verification', response: Response) {
    if (passkeyLoginShouldResumeSession(response.status)) {
      replaceParticipantLoginHistory(window.location, returnTo)
      return
    }

    const nextFailure = passkeyLoginHttpFailure(stage, response.status)
    finishWithFailure(
      nextFailure,
      nextFailure.action === 'wait' ? response.headers.get('Retry-After') : null,
    )
  }

  async function authenticate() {
    if (support !== 'supported' || loginState === 'working' || loginInFlight.current) return

    loginInFlight.current = true
    setFailure(null)
    retryCooldown.clearRetryCooldown()
    setLoginState('working')
    let requestStage: 'options' | 'verification' = 'options'
    try {
      const query = new URLSearchParams({ redirectKey })
      if (tournamentSlug) query.set('tournamentSlug', tournamentSlug)
      const optionsResponse = await fetch(`/api/auth/passkeys/authenticate/options?${query}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      if (!optionsResponse.ok) {
        handleRejectedResponse('options', optionsResponse)
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
      const verificationResponse = await fetch('/api/auth/passkeys/authenticate/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(authentication),
      })
      if (!verificationResponse.ok) {
        handleRejectedResponse('verification', verificationResponse)
        return
      }

      const result = (await verificationResponse.json()) as { redirectTo?: string }
      // A full replacement picks up the unified session cookie without retaining the transient page.
      replaceParticipantLoginHistory(window.location, result.redirectTo ?? returnTo)
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
  const mustWait = failure?.action === 'wait' && retryCooldown.retryAfterSeconds !== null
  const isUnavailable = support !== 'supported'
  const buttonLabel =
    support === 'checking'
      ? '浏览器功能待确认'
      : support === 'unsupported'
        ? '当前设备暂不可用'
        : isWorking
          ? '正在等待设备确认…'
          : failure?.action === 'reload'
            ? '刷新登录页面'
            : mustWait
              ? `${retryCooldown.retryDelayLabel}后可重试`
              : failure
                ? '重新开始设备确认'
                : '使用通行密钥登录'

  return (
    <div className={styles.passkeyControl} aria-busy={isWorking}>
      <button
        type="button"
        className={styles.passkeyButton}
        disabled={isUnavailable || isWorking || mustWait}
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
        {support === 'checking' ? (
          <RecoveryPanel {...PENDING_CLIENT_RECOVERY} receiptPath={receiptPath} />
        ) : null}
        {support === 'unsupported' ? (
          <RecoveryPanel {...UNSUPPORTED_RECOVERY} receiptPath={receiptPath} />
        ) : null}
        {support === 'supported' && failure ? (
          <RecoveryPanel
            code={failure.code}
            signal={FAILURE_SIGNAL[failure.code]}
            title={failure.title}
            description={
              mustWait
                ? `${failure.description} 本页会在${retryCooldown.retryDelayLabel}后自动恢复操作。`
                : failure.description
            }
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
