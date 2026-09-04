import assert from 'node:assert/strict'

import {
  PasswordScreeningUnavailableError,
  checkPwnedPassword,
  containsPasswordContext,
  resolveLocalPasswordRangeService,
} from '../lib/identity/internal/password-screening.ts'
import passwordRangeWorker from './browser-password-range-worker.mjs'

const localService = { fetch: async () => new Response() }
assert.equal(resolveLocalPasswordRangeService('https://cup.example', undefined, undefined), null)
assert.equal(
  resolveLocalPasswordRangeService('http://localhost:3000', 'browser-check', localService),
  localService,
)
for (const [siteOrigin, configured, service] of [
  ['https://cup.example', 'browser-check', localService],
  ['http://127.0.0.1:3000', 'browser-check', localService],
  ['http://localhost:3000/path', 'browser-check', localService],
  ['http://localhost:3000', 'development', localService],
  ['http://localhost:3000', 'browser-check', undefined],
  ['http://localhost:3000', 'browser-check', {}],
]) {
  assert.throws(
    () => resolveLocalPasswordRangeService(siteOrigin, configured, service),
    PasswordScreeningUnavailableError,
  )
}

const rangeHeaders = { Accept: 'text/plain', 'Add-Padding': 'true' }
const mockedPwned = await passwordRangeWorker.fetch(
  new Request('https://password-range.browser.invalid/range/5BAA6', { headers: rangeHeaders }),
)
assert.equal(mockedPwned.status, 200)
assert.match(await mockedPwned.text(), /1E4C9B93F3F0682250B6CF8331B7EE68FD8:3303003/)
const rejectedRange = await passwordRangeWorker.fetch(
  new Request('https://password-range.browser.invalid/range/5baa6', { headers: rangeHeaders }),
)
assert.equal(rejectedRange.status, 400)

const passwordHashSuffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'
let requestedUrl = ''
const compromised = await checkPwnedPassword('password', {
  fetcher: async (url, init) => {
    requestedUrl = String(url)
    assert.equal(init.headers['Add-Padding'], 'true')
    assert.equal(init.redirect, 'manual')
    return new Response(
      `00000000000000000000000000000000000:0\r\n${passwordHashSuffix}:3303003\r\n`,
    )
  },
})
assert.equal(requestedUrl, 'https://api.pwnedpasswords.com/range/5BAA6')
assert.deepEqual(compromised, { compromised: true, occurrenceCount: 3_303_003 })

const novel = await checkPwnedPassword('a novel test password', {
  fetcher: async () => new Response('00000000000000000000000000000000000:0\r\n'),
})
assert.deepEqual(novel, { compromised: false, occurrenceCount: 0 })

const paddedRange = Array.from(
  { length: 2_000 },
  (_, index) => `${index.toString(16).toUpperCase().padStart(35, '0')}:0`,
).join('\r\n')
const padded = await checkPwnedPassword('a novel test password', {
  fetcher: async () => new Response(paddedRange),
})
assert.deepEqual(padded, { compromised: false, occurrenceCount: 0 })

await assert.rejects(
  checkPwnedPassword('a novel test password', {
    fetcher: async () => new Response('not-a-range-response'),
  }),
  PasswordScreeningUnavailableError,
)
await assert.rejects(
  checkPwnedPassword('a novel test password', {
    fetcher: async () => new Response('x'.repeat(128 * 1024 + 1)),
  }),
  PasswordScreeningUnavailableError,
)
await assert.rejects(
  checkPwnedPassword('a novel test password', {
    fetcher: async () => Response.redirect('https://example.com/range', 302),
  }),
  PasswordScreeningUnavailableError,
)

assert.equal(containsPasswordContext('My cs2cup password is long', ['cs2cup']), true)
assert.equal(containsPasswordContext('unrelated high entropy phrase', ['m1ng']), false)

console.log('identity password compromised-value screening passed')
