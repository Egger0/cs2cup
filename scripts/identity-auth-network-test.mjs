import assert from 'node:assert/strict'

import { networkAuthAttemptCharge } from '../lib/identity/internal/auth-network.ts'

const key = { version: 1, key: Uint8Array.from({ length: 32 }, (_, index) => index) }
const ipv6TemporaryA = new Headers({ 'cf-connecting-ip': '2001:db8:1:2:1234:5678:9abc:def0' })
const ipv6TemporaryB = new Headers({ 'cf-connecting-ip': '2001:db8:1:2:ffff:eeee:dddd:cccc' })
const environment = { NODE_ENV: 'production', REGISTRATION_CLIENT_IP_SOURCE: 'cf-connecting-ip' }
const first = await networkAuthAttemptCharge(ipv6TemporaryA, 'sign_in', key, 100, environment)
const second = await networkAuthAttemptCharge(ipv6TemporaryB, 'sign_in', key, 100, environment)
assert.deepEqual(first, second)
assert.equal(first.dimension, 'network')
assert.equal(first.limit, 100)

await assert.rejects(
  networkAuthAttemptCharge(new Headers(), 'sign_in', key, 100, environment),
  /Trusted client IP header/,
)

console.log('identity authentication network fingerprinting passed')
