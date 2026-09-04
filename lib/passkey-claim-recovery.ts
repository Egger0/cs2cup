export interface PasskeyClaimFeedback {
  readonly code:
    | 'receipt-refresh-required'
    | 'rate-limited'
    | 'temporarily-unavailable'
    | 'verification-failed'
    | 'verification-uncertain'
    | 'interrupted-or-unavailable'
  readonly title: string
  readonly description: string
  readonly action: 'retry' | 'reload' | 'wait'
}

const RECEIPT_REFRESH_REQUIRED: PasskeyClaimFeedback = {
  code: 'receipt-refresh-required',
  title: '请刷新报名回执',
  description: '这次创建请求已失效，或报名状态已经变化。刷新回执后再继续。',
  action: 'reload',
}

const RATE_LIMITED: PasskeyClaimFeedback = {
  code: 'rate-limited',
  title: '请求过于频繁',
  description: '请等待当前限制窗口结束，再从这份报名回执重新发起创建；系统不会自动提交。',
  action: 'wait',
}

const TEMPORARILY_UNAVAILABLE: PasskeyClaimFeedback = {
  code: 'temporarily-unavailable',
  title: '暂时无法创建通行密钥',
  description: '当前设备或服务暂时无法完成创建，请稍后重新尝试。',
  action: 'retry',
}

const VERIFICATION_FAILED: PasskeyClaimFeedback = {
  code: 'verification-failed',
  title: '本次设备确认未完成',
  description: '本次创建请求已经失效，请发起一份新的请求，再完成设备确认。',
  action: 'retry',
}

const VERIFICATION_UNCERTAIN: PasskeyClaimFeedback = {
  code: 'verification-uncertain',
  title: '创建结果需要确认',
  description: '网络在提交后中断，账号关联可能已经完成。请刷新报名回执确认状态。',
  action: 'reload',
}

const INTERRUPTED: PasskeyClaimFeedback = {
  code: 'interrupted-or-unavailable',
  title: '设备确认未完成',
  description: '设备确认可能被取消或超时，请重新发起创建。',
  action: 'retry',
}

export function passkeyClaimHttpFailure(
  stage: 'options' | 'verification',
  status: number,
): PasskeyClaimFeedback {
  if (stage === 'options') {
    if (status === 400 || status === 403 || status === 404) return RECEIPT_REFRESH_REQUIRED
    if (status === 429) return RATE_LIMITED
    return TEMPORARILY_UNAVAILABLE
  }

  if (status === 403 || status === 409) return RECEIPT_REFRESH_REQUIRED
  if (status === 400) return VERIFICATION_FAILED
  if (status === 0) return VERIFICATION_UNCERTAIN
  return TEMPORARILY_UNAVAILABLE
}

function errorField(value: unknown, field: 'name' | 'code' | 'cause'): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }

  try {
    return Reflect.get(value, field)
  } catch {
    return undefined
  }
}

function isInterrupted(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error

  for (let depth = 0; depth < 8; depth += 1) {
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) {
      return false
    }
    if (seen.has(current)) return false
    seen.add(current)

    const name = errorField(current, 'name')
    const code = errorField(current, 'code')
    if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') {
      return true
    }

    current = errorField(current, 'cause')
  }

  return false
}

export function passkeyClaimDeviceFailure(error: unknown): PasskeyClaimFeedback {
  return isInterrupted(error) ? INTERRUPTED : TEMPORARILY_UNAVAILABLE
}
