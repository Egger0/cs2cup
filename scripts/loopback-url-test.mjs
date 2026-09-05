import assert from 'node:assert/strict'
import { isClientChunkUrl } from './client-chunk-blocker.mjs'
import { installLoopbackRequestGuard, resolveE2EBaseUrl } from './loopback-url.mjs'

assert.equal(resolveE2EBaseUrl(undefined), 'http://127.0.0.1:3000')
assert.equal(resolveE2EBaseUrl('http://localhost:3100'), 'http://localhost:3100')
assert.equal(resolveE2EBaseUrl('https://[::1]:8443'), 'https://[::1]:8443')

for (const value of [
  '',
  ' https://localhost:3000',
  'ftp://127.0.0.1:3000',
  'http://127.0.0.2:3000',
  'http://0.0.0.0:3000',
  'http://user@localhost:3000',
  'http://localhost:3000/path',
  'http://localhost:3000/?query=1',
  'https://example.com',
]) {
  assert.throws(() => resolveE2EBaseUrl(value), /loopback HTTP\(S\) origin/)
}

const base = 'http://localhost:3000'
for (const url of [
  `${base}/_next/static/chunks/main.js`,
  `${base}/_next/static/chunks/app/(public)/layout-a1b2c3.js`,
  `${base}/_next/static/chunks/app/deep/client.js?v=1`,
]) {
  assert.equal(isClientChunkUrl(url, base), true, url)
}
for (const url of [
  `${base}/_next/static/chunks/app/(public)/layout.css`,
  `${base}/_next/static/media/client.js`,
  `https://example.com/_next/static/chunks/app/layout.js`,
]) {
  assert.equal(isClientChunkUrl(url, base), false, url)
}

let requestHandler
let socketHandler
const context = {
  async route(_pattern, handler) {
    requestHandler = handler
  },
  async routeWebSocket(_pattern, handler) {
    socketHandler = handler
  },
}
const guard = await installLoopbackRequestGuard(context)

let continued = false
await requestHandler({
  request: () => ({ url: () => 'http://127.0.0.1:3000/app.js' }),
  continue: async () => {
    continued = true
  },
  abort: async () => assert.fail('Loopback request was blocked'),
})
assert.equal(continued, true)

for (const url of [
  'blob:http://127.0.0.1:3000/local-card',
  'blob:http://localhost:3000/local-card',
  'blob:https://[::1]:8443/local-card',
]) {
  let allowed = false
  await requestHandler({
    request: () => ({ url: () => url }),
    continue: async () => {
      allowed = true
    },
    abort: async () => assert.fail(`Local object URL was blocked: ${url}`),
  })
  assert.equal(allowed, true)
}
guard.assertSafe()

let abortedWith
await requestHandler({
  request: () => ({ url: () => 'https://example.com/tracker.js' }),
  continue: async () => assert.fail('External request was allowed'),
  abort: async reason => {
    abortedWith = reason
  },
})
assert.equal(abortedWith, 'blockedbyclient')

let connected = false
await socketHandler({
  url: () => 'ws://localhost:3000/_next/webpack-hmr',
  connectToServer: () => {
    connected = true
  },
  close: async () => assert.fail('Loopback WebSocket was blocked'),
})
assert.equal(connected, true)

let closedWith
await socketHandler({
  url: () => 'wss://example.com/live',
  connectToServer: () => assert.fail('External WebSocket was allowed'),
  close: async options => {
    closedWith = options
  },
})
assert.deepEqual(closedWith, { code: 1008, reason: 'Non-loopback request blocked' })
assert.throws(
  () => guard.assertSafe(),
  /https:\/\/example\.com\/tracker\.js, wss:\/\/example\.com\/live/,
)

for (const url of [
  'blob:https://example.com/card',
  'blob:http://localhost.example.com/card',
  'blob:http://user@localhost/card',
  'blob:ftp://localhost/card',
  'blob:blob:http://localhost/card',
  'blob:null/card',
]) {
  let blocked = false
  await requestHandler({
    request: () => ({ url: () => url }),
    continue: async () => assert.fail(`Unsafe object URL was allowed: ${url}`),
    abort: async () => {
      blocked = true
    },
  })
  assert.equal(blocked, true)
}

console.log('loopback URL tests passed')
