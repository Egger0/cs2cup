import assert from 'node:assert/strict'

import {
  participantLoginReceiptPath,
  passkeyLoginDeviceFailure,
  passkeyLoginHttpFailure,
  passkeyLoginShouldResumeSession,
} from '../lib/passkey-login-recovery.ts'
import { passkeyRetryAfterSeconds } from '../lib/passkey-retry-cooldown.ts'

const REFRESH_REQUIRED = {
  code: 'refresh-required',
  title: '登录页面已过期',
  description: '这次登录请求已经失效。刷新页面后可重新发起验证。',
  action: 'reload',
}
const RATE_LIMITED = {
  code: 'rate-limited',
  title: '请求过于频繁',
  description: '请等待当前限制窗口结束，再由你重新发起通行密钥验证。',
  action: 'wait',
}
const TEMPORARILY_UNAVAILABLE = {
  code: 'temporarily-unavailable',
  title: '登录服务暂不可用',
  description: '暂时无法完成登录，请稍后重试。',
  action: 'retry',
}
const VERIFICATION_FAILED = {
  code: 'verification-failed',
  title: '未能确认通行密钥',
  description: '验证结果未通过，请重新发起登录。',
  action: 'retry',
}
const INTERRUPTED_OR_UNAVAILABLE = {
  code: 'interrupted-or-unavailable',
  title: '验证未完成',
  description: '验证可能被取消、超时或当前设备暂不可用，请重新尝试。',
  action: 'retry',
}

for (const [stage, status, expected] of [
  ['options', 403, REFRESH_REQUIRED],
  ['options', 429, RATE_LIMITED],
  ['options', 400, TEMPORARILY_UNAVAILABLE],
  ['options', 503, TEMPORARILY_UNAVAILABLE],
  ['verification', 403, REFRESH_REQUIRED],
  ['verification', 400, VERIFICATION_FAILED],
  ['verification', 429, TEMPORARILY_UNAVAILABLE],
  ['verification', 503, TEMPORARILY_UNAVAILABLE],
]) {
  assert.deepEqual(passkeyLoginHttpFailure(stage, status), expected)
}

assert.equal(passkeyLoginShouldResumeSession(409), true)
for (const status of [0, 200, 400, 403, 429, 503]) {
  assert.equal(passkeyLoginShouldResumeSession(status), false)
}

for (const [header, expected] of [
  ['1', 1],
  ['60', 60],
  ['599', 599],
  ['600', 600],
  [null, 60],
  ['', 60],
  ['0', 60],
  ['601', 60],
  ['060', 60],
  [' 60', 60],
  ['60 ', 60],
  ['1.5', 60],
  ['-1', 60],
]) {
  assert.equal(passkeyRetryAfterSeconds(header), expected)
}

const secret = 'raw authenticator message must stay private'
const notAllowed = new DOMException(secret, 'NotAllowedError')
const aborted = new DOMException(secret, 'AbortError')
const notAllowedCause = new Error('outer message', { cause: notAllowed })
const abortedCause = new Error('outer message', { cause: aborted })
const ceremonyAborted = Object.assign(new Error(secret), { code: 'ERROR_CEREMONY_ABORTED' })

for (const error of [notAllowed, aborted, notAllowedCause, abortedCause, ceremonyAborted]) {
  const feedback = passkeyLoginDeviceFailure(error)
  assert.deepEqual(feedback, INTERRUPTED_OR_UNAVAILABLE)
  assert.equal(JSON.stringify(feedback).includes(secret), false)
  assert.equal(JSON.stringify(feedback).includes('outer message'), false)
}

for (const error of [
  new DOMException(secret, 'SecurityError'),
  new Error(secret),
  Object.assign(new Error(secret), { code: 'ERROR_INVALID_RP_ID' }),
  new Error('ERROR_CEREMONY_ABORTED'),
  secret,
  null,
  undefined,
]) {
  const feedback = passkeyLoginDeviceFailure(error)
  assert.deepEqual(feedback, TEMPORARILY_UNAVAILABLE)
  assert.equal(JSON.stringify(feedback).includes(secret), false)
}

const cyclicError = new Error(secret)
cyclicError.cause = cyclicError
assert.deepEqual(passkeyLoginDeviceFailure(cyclicError), TEMPORARILY_UNAVAILABLE)

const token = 'A_-a09'.repeat(7) + 'A'
const registrationPath = `/tournaments/autumn-cup-2026/registration/${token}`
assert.equal(token.length, 43)
assert.equal(participantLoginReceiptPath(registrationPath), registrationPath)
assert.equal(
  participantLoginReceiptPath(`/tournaments/a/registration/${token}`),
  `/tournaments/a/registration/${token}`,
)

for (const value of [
  '/me',
  '/me/',
  '/me?returnTo=registration',
  undefined,
  null,
  7,
  [registrationPath],
  '',
  '/',
  '//example.com/tournaments/autumn-cup-2026/registration/' + token,
  `https://example.com${registrationPath}`,
  `javascript:${registrationPath}`,
  `${registrationPath}?next=/me`,
  `${registrationPath}#receipt`,
  `${registrationPath}/`,
  `/tournaments/Autumn-cup/registration/${token}`,
  `/tournaments/autumn_cup/registration/${token}`,
  `/tournaments/-autumn-cup/registration/${token}`,
  `/tournaments/autumn-cup/registration/${token.slice(1)}`,
  `/tournaments/autumn-cup/registration/${token}!`,
  `/tournaments/autumn-cup/registration/${token}\n`,
  `/tournaments/autumn-cup%2Fregistration%2F${token}`,
]) {
  assert.equal(
    participantLoginReceiptPath(value),
    null,
    `expected rejected receipt: ${String(value)}`,
  )
}

console.log('passkey login recovery tests passed')
