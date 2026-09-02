import { participantRegistrationReturnPath } from './participant-return.ts'

export interface PasskeyLoginFeedback {
  readonly code:
    | 'refresh-required'
    | 'rate-limited'
    | 'temporarily-unavailable'
    | 'verification-failed'
    | 'interrupted-or-unavailable'
  readonly title: string
  readonly description: string
  readonly action: 'retry' | 'reload' | 'wait'
}

const REFRESH_REQUIRED: PasskeyLoginFeedback = {
  code: 'refresh-required',
  title: '登录页面已过期',
  description: '这次登录请求已经失效。刷新页面后可重新发起验证。',
  action: 'reload',
}

const RATE_LIMITED: PasskeyLoginFeedback = {
  code: 'rate-limited',
  title: '请求过于频繁',
  description: '请等待几分钟，再由你重新发起通行密钥验证。',
  action: 'wait',
}

const TEMPORARILY_UNAVAILABLE: PasskeyLoginFeedback = {
  code: 'temporarily-unavailable',
  title: '登录服务暂不可用',
  description: '暂时无法完成登录，请稍后重试。',
  action: 'retry',
}

const VERIFICATION_FAILED: PasskeyLoginFeedback = {
  code: 'verification-failed',
  title: '未能确认通行密钥',
  description: '验证结果未通过，请重新发起登录。',
  action: 'retry',
}

const INTERRUPTED_OR_UNAVAILABLE: PasskeyLoginFeedback = {
  code: 'interrupted-or-unavailable',
  title: '验证未完成',
  description: '验证可能被取消、超时或当前设备暂不可用，请重新尝试。',
  action: 'retry',
}

export function passkeyLoginHttpFailure(
  stage: 'options' | 'verification',
  status: number,
): PasskeyLoginFeedback {
  if (status === 403) return REFRESH_REQUIRED
  if (stage === 'options' && status === 429) return RATE_LIMITED
  if (stage === 'verification' && status === 400) return VERIFICATION_FAILED
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

function isInterruptedOrUnavailable(error: unknown): boolean {
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

export function passkeyLoginDeviceFailure(error: unknown): PasskeyLoginFeedback {
  return isInterruptedOrUnavailable(error) ? INTERRUPTED_OR_UNAVAILABLE : TEMPORARILY_UNAVAILABLE
}

export function participantLoginReceiptPath(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const parts = value.split('/')
  if (
    parts.length !== 5 ||
    parts[0] !== '' ||
    parts[1] !== 'tournaments' ||
    parts[3] !== 'registration'
  ) {
    return null
  }

  const slug = parts[2]
  const token = parts[4]
  if (!slug || !token) return null

  const path = participantRegistrationReturnPath(slug, token)
  return path === value ? path : null
}
