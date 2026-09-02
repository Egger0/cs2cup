'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const RETRY_AFTER_FALLBACK_SECONDS = 60
const RETRY_AFTER_MAX_SECONDS = 10 * 60

interface RetryCooldown {
  retryAt: number
  delaySeconds: number
}

export function passkeyRetryAfterSeconds(value: string | null): number {
  if (!value || !/^[1-9][0-9]{0,2}$/.test(value)) return RETRY_AFTER_FALLBACK_SECONDS
  const seconds = Number(value)
  return seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : RETRY_AFTER_FALLBACK_SECONDS
}

function retryDelayLabel(seconds: number) {
  return seconds >= 60 ? `约 ${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`
}

export function usePasskeyRetryCooldown(onElapsed: () => void) {
  const [cooldown, setCooldown] = useState<RetryCooldown | null>(null)
  const onElapsedRef = useRef(onElapsed)

  useEffect(() => {
    onElapsedRef.current = onElapsed
  }, [onElapsed])

  useEffect(() => {
    if (cooldown === null) return
    let timer: number | null = null

    const releaseIfReady = () => {
      const remaining = cooldown.retryAt - Date.now()
      if (remaining > 0) {
        if (timer !== null) window.clearTimeout(timer)
        timer = window.setTimeout(releaseIfReady, remaining)
        return
      }
      setCooldown(null)
      onElapsedRef.current()
    }
    const releaseVisiblePage = () => {
      if (!document.hidden) releaseIfReady()
    }

    timer = window.setTimeout(releaseIfReady, Math.max(0, cooldown.retryAt - Date.now()))
    window.addEventListener('focus', releaseIfReady)
    window.addEventListener('pageshow', releaseIfReady)
    document.addEventListener('visibilitychange', releaseVisiblePage)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('focus', releaseIfReady)
      window.removeEventListener('pageshow', releaseIfReady)
      document.removeEventListener('visibilitychange', releaseVisiblePage)
    }
  }, [cooldown])

  const startRetryCooldown = useCallback((retryAfter: string | null) => {
    const delaySeconds = passkeyRetryAfterSeconds(retryAfter)
    setCooldown({ retryAt: Date.now() + delaySeconds * 1000, delaySeconds })
  }, [])
  const clearRetryCooldown = useCallback(() => setCooldown(null), [])

  return {
    retryAfterSeconds: cooldown?.delaySeconds ?? null,
    retryDelayLabel: cooldown ? retryDelayLabel(cooldown.delaySeconds) : null,
    startRetryCooldown,
    clearRetryCooldown,
  }
}
