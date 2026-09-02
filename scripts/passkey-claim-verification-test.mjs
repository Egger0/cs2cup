import assert from 'node:assert/strict'

import { CsrfError } from '../lib/csrf.ts'
import { PasskeyRequestError } from '../lib/passkey-json.ts'
import {
  ParticipantRegistrationRejected,
  participantClaimVerificationFailure,
} from '../lib/passkey-claim-verification.ts'
import { ParticipantPasskeyError } from '../lib/queries/participant-passkey-shared.ts'

const secret = 'raw verification detail must stay private'

for (const [error, expected] of [
  [new CsrfError(), { status: 403, message: '请求来源无法确认，请刷新页面重试。' }],
  [new PasskeyRequestError(), { status: 400 }],
  [new ParticipantRegistrationRejected(), { status: 400 }],
  [new ParticipantPasskeyError('invalid_challenge'), { status: 400 }],
  [
    new ParticipantPasskeyError('conflict'),
    { status: 409, message: '创建状态需要重新确认，请刷新报名回执。' },
  ],
  [
    new ParticipantPasskeyError('entry_already_claimed'),
    { status: 503, message: '通行密钥服务暂不可用，请稍后重试。' },
  ],
  [new Error(secret), { status: 503, message: '通行密钥服务暂不可用，请稍后重试。' }],
  [secret, { status: 503, message: '通行密钥服务暂不可用，请稍后重试。' }],
]) {
  const failure = participantClaimVerificationFailure(error)
  assert.deepEqual(failure, expected)
  assert.equal(JSON.stringify(failure).includes(secret), false)
}

console.log('passkey claim verification status tests passed')
