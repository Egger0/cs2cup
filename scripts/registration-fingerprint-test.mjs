import assert from 'node:assert/strict'

import {
  fingerprintAddress,
  fingerprintFromHeaders,
  registrationClientIpSource,
} from '../lib/ratelimit-fingerprint.ts'

const secret = 'registration-test-secret-32-bytes-minimum'
const otherSecret = 'other-registration-secret-32-bytes-minimum'

const first = fingerprintAddress('203.0.113.10', secret)
assert.match(first, /^v1:[0-9a-f]{64}$/)
assert.equal(first, fingerprintAddress(' 203.0.113.10 ', secret))
assert.notEqual(first, fingerprintAddress('203.0.113.11', secret))
assert.notEqual(first, fingerprintAddress('203.0.113.10', otherSecret))

assert.equal(
  fingerprintAddress('2001:0db8:0:0:0:0:0:1', secret),
  fingerprintAddress('2001:db8::1', secret),
)
assert.equal(
  fingerprintAddress('2001:db8:abcd:12::1', secret),
  fingerprintAddress('2001:db8:abcd:12:ffff:ffff:ffff:ffff', secret),
)
assert.notEqual(
  fingerprintAddress('2001:db8:abcd:12::1', secret),
  fingerprintAddress('2001:db8:abcd:13::1', secret),
)
assert.equal(
  fingerprintAddress('::ffff:192.0.2.7', secret),
  fingerprintAddress('192.0.2.7', secret),
)

const realIpHeaders = new Headers({
  'x-real-ip': '198.51.100.4',
  'user-agent': 'attacker-controlled-value',
})
const changedAgentHeaders = new Headers({
  'x-real-ip': '198.51.100.4',
  'user-agent': 'different-attacker-controlled-value',
})
assert.equal(
  fingerprintFromHeaders(realIpHeaders, { clientIpSource: 'x-real-ip', secret }),
  fingerprintFromHeaders(changedAgentHeaders, { clientIpSource: 'x-real-ip', secret }),
)

const cloudflareHeaders = new Headers({ 'cf-connecting-ip': '192.0.2.7' })
assert.equal(
  fingerprintFromHeaders(cloudflareHeaders, {
    clientIpSource: 'cf-connecting-ip',
    secret,
  }),
  fingerprintAddress('192.0.2.7', secret),
)

assert.throws(() => fingerprintAddress('not-an-ip', secret), /valid IP address/)
assert.throws(() => fingerprintAddress('192.0.2.1', 'short'), /at least 32 bytes/)
assert.throws(
  () => fingerprintFromHeaders(new Headers(), { secret }),
  /trusted client IP header x-real-ip is missing/i,
)
const developmentFingerprint = fingerprintFromHeaders(new Headers(), {
  fallbackAddress: '127.0.0.1',
  secret,
})
assert.match(developmentFingerprint, /^v1:[0-9a-f]{64}$/)
assert.equal(
  developmentFingerprint,
  fingerprintFromHeaders(new Headers(), {
    fallbackAddress: '127.0.0.1',
    secret,
  }),
)
assert.equal(registrationClientIpSource('cf-connecting-ip'), 'cf-connecting-ip')
assert.throws(() => registrationClientIpSource(undefined, true), /required outside development/)
assert.throws(
  () => registrationClientIpSource('cloudbase'),
  /must be x-real-ip or cf-connecting-ip/,
)
assert.throws(
  () => registrationClientIpSource('x-forwarded-for'),
  /must be x-real-ip or cf-connecting-ip/,
)

console.log('registration fingerprint tests passed')
