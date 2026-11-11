import assert from 'node:assert/strict'

import { EDGE_FRESH_SECONDS, edgeCached, isEdgeCacheable } from '../lib/edge-cache.ts'

const get = (path, headers = {}) =>
  new Request(`https://example.test${path}`, { headers: { accept: 'text/html', ...headers } })

for (const path of [
  '/',
  '/news',
  '/news/season-update',
  '/tournaments',
  '/tournaments/2026-nlc',
  '/tournaments/2026-nlc/bracket',
  '/tournaments/2026-nlc/teams/FLC',
  '/tournaments/2026-nlc/matches/7',
  '/archive',
  '/players/aster',
]) {
  assert.equal(isEdgeCacheable(get(path)), true, `${path} is cacheable`)
}
for (const path of [
  '/login',
  '/me',
  '/guestbook',
  '/lottery',
  '/tournaments/2026-nlc/register',
  '/tournaments/2026-nlc/registration/token',
  '/api/comments',
  '/admin',
  '/search',
]) {
  assert.equal(isEdgeCacheable(get(path)), false, `${path} is not cacheable`)
}
assert.equal(isEdgeCacheable(get('/news', { cookie: '__Host-cs2cup_session=abc' })), false)
assert.equal(isEdgeCacheable(get('/news', { cookie: '__Host-cs2cup_participant=abc' })), false)
assert.equal(isEdgeCacheable(get('/news', { cookie: '_ga=1' })), true)
assert.equal(isEdgeCacheable(get('/news', { rsc: '1' })), false, 'flight without a state hash')
assert.equal(isEdgeCacheable(get('/news?_rsc=abc')), false, 'html never carries a flight hash')
assert.equal(isEdgeCacheable(get('/news?_rsc=abc', { rsc: '1', accept: '*/*' })), true)
assert.equal(
  isEdgeCacheable(get('/news?_rsc=abc', { rsc: '1', cookie: '__Host-cs2cup_session=x' })),
  false,
)
assert.equal(isEdgeCacheable(get('/news', { 'next-action': 'abc' })), false)
assert.equal(isEdgeCacheable(get('/news', { accept: 'application/json' })), false)
assert.equal(isEdgeCacheable(new Request('https://example.test/news', { method: 'POST' })), false)

const entries = new Map()
const cache = {
  async match(request) {
    const stored = entries.get(request.url)
    return stored ? new Response(stored.body, stored.init) : undefined
  },
  async put(request, response) {
    entries.set(request.url, {
      body: await response.text(),
      init: { headers: [...response.headers] },
    })
  },
}
const pending = []
const context = { waitUntil: promise => pending.push(promise) }
let renders = 0
const render = async () => {
  renders += 1
  return new Response(`page ${renders}`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
  })
}
let clock = 1_000_000
const now = () => clock
const run = async request => {
  const response = await edgeCached(request, context, render, cache, 'v1', now)
  const text = await response.text()
  await Promise.all(pending.splice(0))
  return { text, response }
}

let result = await run(get('/news'))
assert.equal(result.text, 'page 1')
assert.equal(result.response.headers.get('x-edge-cache'), 'miss')
assert.equal(result.response.headers.get('cache-control'), 'public, max-age=0, must-revalidate')

result = await run(get('/news'))
assert.equal(result.text, 'page 1', 'a fresh entry is served from the cache')
assert.equal(result.response.headers.get('x-edge-cache'), 'hit')
assert.equal(renders, 1)

clock += (EDGE_FRESH_SECONDS + 1) * 1000
result = await run(get('/news'))
assert.equal(result.text, 'page 1', 'a stale entry is served while it refreshes')
assert.equal(result.response.headers.get('x-edge-cache'), 'stale')
assert.equal(renders, 2)
result = await run(get('/news'))
assert.equal(result.text, 'page 2', 'the refreshed entry replaces the stale one')

result = await run(get('/news', { cookie: '__Host-cs2cup_session=abc' }))
assert.equal(result.text, 'page 3', 'signed-in requests always render')
assert.equal(result.response.headers.get('x-edge-cache'), null)

const failing = async () =>
  new Response('boom', { status: 500, headers: { 'content-type': 'text/html' } })
const failure = await edgeCached(get('/about'), context, failing, cache, 'v1', now)
assert.equal(failure.status, 500)
assert.equal(
  [...entries.keys()].some(key => key.includes('/about')),
  false,
  'errors are never stored',
)

const cookied = async () =>
  new Response('x', { headers: { 'content-type': 'text/html', 'set-cookie': 'a=b' } })
await edgeCached(get('/archive'), context, cookied, cache, 'v1', now)
assert.equal(
  [...entries.keys()].some(key => key.includes('/archive')),
  false,
  'responses that set cookies are never stored',
)

result = await edgeCached(get('/news'), context, render, cache, 'v2', now)
await Promise.all(pending.splice(0))
assert.equal(
  result.headers.get('x-edge-cache'),
  'miss',
  'a new deployment never reuses the previous version',
)

const flight = async () =>
  new Response('flight', { headers: { 'content-type': 'text/x-component' } })
const flightRequest = get('/news?_rsc=abc', { rsc: '1', accept: '*/*' })
result = await edgeCached(flightRequest, context, flight, cache, 'v1', now)
await Promise.all(pending.splice(0))
assert.equal(result.headers.get('x-edge-cache'), 'miss')
result = await edgeCached(get('/news'), context, render, cache, 'v1', now)
assert.notEqual(await result.text(), 'flight', 'html and flight responses never share an entry')
result = await edgeCached(flightRequest, context, flight, cache, 'v1', now)
assert.equal(await result.text(), 'flight')
assert.equal(result.headers.get('x-edge-cache'), 'hit')

console.log('edge cache tests passed')
