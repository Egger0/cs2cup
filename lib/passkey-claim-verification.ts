import 'server-only'

import { CsrfError } from './csrf.ts'
import { PasskeyRequestError } from './passkey-json.ts'
import { ParticipantPasskeyError } from './queries/participant-passkey-shared.ts'

export class ParticipantRegistrationRejected extends Error {
  constructor() {
    super('Participant registration verification failed')
    this.name = 'ParticipantRegistrationRejected'
  }
}

export interface ParticipantClaimVerificationFailure {
  readonly status: 400 | 403 | 409 | 503
  readonly message?: string
}

export function participantClaimVerificationFailure(
  error: unknown,
): ParticipantClaimVerificationFailure {
  if (error instanceof CsrfError) {
    return { status: 403, message: '请求来源无法确认，请刷新页面重试。' }
  }
  if (error instanceof PasskeyRequestError || error instanceof ParticipantRegistrationRejected) {
    return { status: 400 }
  }
  if (error instanceof ParticipantPasskeyError) {
    if (error.code === 'invalid_challenge') return { status: 400 }
    if (error.code === 'conflict') {
      return { status: 409, message: '创建状态需要重新确认，请刷新报名回执。' }
    }
  }
  return { status: 503, message: '通行密钥服务暂不可用，请稍后重试。' }
}
