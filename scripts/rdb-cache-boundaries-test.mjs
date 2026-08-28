import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  RdbError,
  callPrivateFunction,
  callPublicFunction,
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRow,
  selectPrivateRows,
  selectPublicRow,
  selectPublicRows,
  updatePrivateRows,
} from '../lib/rdb.ts'
import {
  MAX_CACHE_TAG_LENGTH,
  MAX_CACHE_TAGS,
  publicDataFetchOptions,
} from '../lib/rdb-cache-policy.ts'
import {
  PRIVATE_NO_STORE,
  PRIVATE_NO_STORE_HEADERS,
  withPrivateNoStore,
} from '../lib/http-cache.ts'

const PUBLIC_ENDPOINT = 'https://public.example.test/rest'
const PRIVATE_ENDPOINT = 'https://private.example.test/rest'
process.env.RDB_BASE_URL = PUBLIC_ENDPOINT
process.env.RDB_ADMIN_BASE_URL = PRIVATE_ENDPOINT

const originalFetch = globalThis.fetch
const calls = []

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
}

globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  calls.push({ url, init })
  if (init.method === 'DELETE') return new Response(null, { status: 204 })
  return jsonResponse(url.includes('/rpc/') ? { ok: true } : [{ id: 1 }])
}

function nextCall() {
  const call = calls.shift()
  assert.ok(call, 'expected a captured fetch call')
  return call
}

function assertNoStore(init) {
  assert.equal(init.cache, 'no-store')
  assert.equal(init.next, undefined)
}

try {
  const publicLayout = await readFile(
    new URL('../app/(public)/layout.tsx', import.meta.url),
    'utf8',
  )
  assert.match(
    publicLayout,
    /export const revalidate\s*=\s*0/,
    'the shared public layout must keep HTML dynamic without disabling explicit fetch caching',
  )
  assert.doesNotMatch(
    publicLayout,
    /export const dynamic\s*=\s*['"]force-dynamic['"]/,
    'force-dynamic would override descendant public-revalidate fetches',
  )

  const tags = ['game', 'game:cs2']
  await selectPublicRows('game', {
    select: 'id',
    cache: { mode: 'revalidate', seconds: 300, tags },
  })
  tags.push('mutated-after-request')
  let call = nextCall()
  assert.match(call.url, new RegExp(`^${PUBLIC_ENDPOINT}/game\\?`))
  assert.equal(call.init.cache, undefined)
  assert.deepEqual(call.init.next, {
    revalidate: 300,
    tags: ['game', 'game:cs2'],
  })

  await selectPublicRows('game', {
    select: 'id',
    cache: { mode: 'no-store' },
  })
  call = nextCall()
  assert.match(call.url, new RegExp(`^${PUBLIC_ENDPOINT}/game\\?`))
  assertNoStore(call.init)

  await selectPublicRow('post', {
    select: 'id',
    cache: { mode: 'no-store' },
  })
  call = nextCall()
  assert.equal(new URL(call.url).searchParams.get('limit'), '1')
  assertNoStore(call.init)

  await selectPrivateRows('admin_user', { select: 'user_id' })
  call = nextCall()
  assert.match(call.url, new RegExp(`^${PRIVATE_ENDPOINT}/admin_user\\?`))
  assertNoStore(call.init)

  await selectPrivateRow('photo', { select: 'id' })
  call = nextCall()
  assert.equal(new URL(call.url).searchParams.get('limit'), '1')
  assertNoStore(call.init)

  await insertPrivateRows('post', { title: 'test' })
  call = nextCall()
  assert.equal(call.init.method, 'POST')
  assert.match(call.url, new RegExp(`^${PRIVATE_ENDPOINT}/post\\?`))
  assertNoStore(call.init)

  await updatePrivateRows('post', { title: 'updated' }, { filters: { id: 'eq.1' } })
  call = nextCall()
  assert.equal(call.init.method, 'PATCH')
  assertNoStore(call.init)

  await deletePrivateRows('post', { filters: { id: 'eq.1' } })
  call = nextCall()
  assert.equal(call.init.method, 'DELETE')
  assertNoStore(call.init)

  await callPublicFunction('registration_status', { p_slug: 'test-cup' })
  call = nextCall()
  assert.equal(call.url, `${PUBLIC_ENDPOINT}/rpc/registration_status`)
  assertNoStore(call.init)

  await callPrivateFunction('replace_bracket', { p_tournament_id: 1 })
  call = nextCall()
  assert.equal(call.url, `${PRIVATE_ENDPOINT}/rpc/replace_bracket`)
  assertNoStore(call.init)

  assert.throws(
    () => selectPublicRows('admin_user', { select: 'user_id', cache: { mode: 'no-store' } }),
    /not an approved public relation/,
  )
  assert.throws(
    () => selectPublicRows('game', { select: '*', cache: { mode: 'no-store' } }),
    /explicit projection without wildcards/,
  )
  assert.throws(
    () => callPublicFunction('submit_team_rate_limited', {}),
    /not an approved public function/,
  )
  assert.throws(
    () => publicDataFetchOptions({ mode: 'revalidate', seconds: 0 }),
    /positive safe integer/,
  )
  assert.throws(
    () =>
      publicDataFetchOptions({
        mode: 'revalidate',
        seconds: 300,
        tags: Array.from({ length: MAX_CACHE_TAGS + 1 }, (_, index) => `tag-${index}`),
      }),
    /at most 128 tags/,
  )
  assert.throws(
    () =>
      publicDataFetchOptions({
        mode: 'revalidate',
        seconds: 300,
        tags: ['x'.repeat(MAX_CACHE_TAG_LENGTH + 1)],
      }),
    /between 1 and 256 characters/,
  )

  globalThis.fetch = async () => {
    throw new Error('connection refused')
  }
  await assert.rejects(
    () => selectPrivateRows('admin_user'),
    error =>
      error instanceof RdbError &&
      error.status === 503 &&
      error.table === 'admin_user' &&
      error.message.includes('connection refused'),
  )

  const response = withPrivateNoStore(new Response('private'))
  assert.equal(response.headers.get('cache-control'), PRIVATE_NO_STORE)
  assert.equal(PRIVATE_NO_STORE_HEADERS['Cache-Control'], PRIVATE_NO_STORE)
  const directives = new Set(
    PRIVATE_NO_STORE.toLowerCase().split(',').map(directive => directive.trim()),
  )
  for (const required of ['private', 'no-cache', 'no-store', 'max-age=0', 'must-revalidate']) {
    assert.ok(directives.has(required), `missing private cache directive: ${required}`)
  }
  for (const forbidden of ['public', 'immutable']) {
    assert.ok(!directives.has(forbidden), `forbidden private cache directive: ${forbidden}`)
  }

  assert.equal(calls.length, 0, 'every captured fetch call must be asserted')
  console.log('RDB and HTTP cache-boundary tests passed')
} finally {
  globalThis.fetch = originalFetch
}
