import assert from 'node:assert/strict'

import {
  passkeyClaimDeviceFailure,
  passkeyClaimHttpFailure,
} from '../lib/passkey-claim-recovery.ts'

const RECEIPT_REFRESH_REQUIRED = {
  code: 'receipt-refresh-required',
  title: '请刷新报名回执',
  description: '这次创建请求已失效，或报名状态已经变化。刷新回执后再继续。',
  action: 'reload',
}
const RATE_LIMITED = {
  code: 'rate-limited',
  title: '请求过于频繁',
  description: '请稍后再从这份报名回执重新发起创建；系统不会自动重试。',
  action: 'wait',
}
const TEMPORARILY_UNAVAILABLE = {
  code: 'temporarily-unavailable',
  title: '暂时无法创建通行密钥',
  description: '当前设备或服务暂时无法完成创建，请稍后重新尝试。',
  action: 'retry',
}
const VERIFICATION_FAILED = {
  code: 'verification-failed',
  title: '本次设备确认未完成',
  description: '本次创建请求已经失效，请发起一份新的请求，再完成设备确认。',
  action: 'retry',
}
const VERIFICATION_UNCERTAIN = {
  code: 'verification-uncertain',
  title: '创建结果需要确认',
  description: '网络在提交后中断，赛事通行证可能已经创建。请刷新报名回执确认状态。',
  action: 'reload',
}
const INTERRUPTED = {
  code: 'interrupted-or-unavailable',
  title: '设备确认未完成',
  description: '设备确认可能被取消或超时，请重新发起创建。',
  action: 'retry',
}

for (const [stage, status, expected] of [
  ['options', 400, RECEIPT_REFRESH_REQUIRED],
  ['options', 403, RECEIPT_REFRESH_REQUIRED],
  ['options', 404, RECEIPT_REFRESH_REQUIRED],
  ['options', 429, RATE_LIMITED],
  ['options', 0, TEMPORARILY_UNAVAILABLE],
  ['options', 409, TEMPORARILY_UNAVAILABLE],
  ['options', 418, TEMPORARILY_UNAVAILABLE],
  ['options', 503, TEMPORARILY_UNAVAILABLE],
  ['options', Number.NaN, TEMPORARILY_UNAVAILABLE],
  ['verification', 400, VERIFICATION_FAILED],
  ['verification', 403, RECEIPT_REFRESH_REQUIRED],
  ['verification', 409, RECEIPT_REFRESH_REQUIRED],
  ['verification', 0, VERIFICATION_UNCERTAIN],
  ['verification', 404, TEMPORARILY_UNAVAILABLE],
  ['verification', 429, TEMPORARILY_UNAVAILABLE],
  ['verification', 503, TEMPORARILY_UNAVAILABLE],
  ['verification', Number.NaN, TEMPORARILY_UNAVAILABLE],
]) {
  assert.deepEqual(passkeyClaimHttpFailure(stage, status), expected)
}

const secret = 'raw authenticator message must stay private'
const outerSecret = 'outer cause message must stay private'
const notAllowed = new DOMException(secret, 'NotAllowedError')
const aborted = new DOMException(secret, 'AbortError')
const nestedNotAllowed = new Error(outerSecret, {
  cause: new Error(outerSecret, { cause: notAllowed }),
})
const nestedAborted = new Error(outerSecret, { cause: aborted })
const ceremonyAborted = Object.assign(new Error(secret), { code: 'ERROR_CEREMONY_ABORTED' })

for (const error of [notAllowed, aborted, nestedNotAllowed, nestedAborted, ceremonyAborted]) {
  const feedback = passkeyClaimDeviceFailure(error)
  assert.deepEqual(feedback, INTERRUPTED)
  assert.equal(JSON.stringify(feedback).includes(secret), false)
  assert.equal(JSON.stringify(feedback).includes(outerSecret), false)
  assert.equal(JSON.stringify(feedback).includes('ERROR_CEREMONY_ABORTED'), false)
}

const throwingFields = {}
Object.defineProperties(throwingFields, {
  name: { get: () => assert.fail('raw name getter must not escape') },
  code: { get: () => assert.fail('raw code getter must not escape') },
  cause: { get: () => assert.fail('raw cause getter must not escape') },
})

for (const error of [
  new DOMException(secret, 'SecurityError'),
  new Error(secret),
  Object.assign(new Error(secret), { code: 'ERROR_INVALID_RP_ID' }),
  new Error('ERROR_CEREMONY_ABORTED'),
  { name: 'UnknownError', message: secret },
  throwingFields,
  secret,
  null,
  undefined,
]) {
  const feedback = passkeyClaimDeviceFailure(error)
  assert.deepEqual(feedback, TEMPORARILY_UNAVAILABLE)
  assert.equal(JSON.stringify(feedback).includes(secret), false)
}

const cyclicError = new Error(secret)
cyclicError.cause = cyclicError
assert.deepEqual(passkeyClaimDeviceFailure(cyclicError), TEMPORARILY_UNAVAILABLE)

const firstCycle = new Error(secret)
const secondCycle = new Error(outerSecret, { cause: firstCycle })
firstCycle.cause = secondCycle
assert.deepEqual(passkeyClaimDeviceFailure(firstCycle), TEMPORARILY_UNAVAILABLE)

console.log('passkey claim recovery tests passed')
