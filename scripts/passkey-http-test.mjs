import assert from 'node:assert/strict'

import { PasskeyRequestError, readPasskeyJson } from '../lib/passkey-json.ts'

async function expectRequestError(request) {
  await assert.rejects(() => readPasskeyJson(request), PasskeyRequestError)
}

assert.deepEqual(
  await readPasskeyJson(
    new Request('https://identity.example/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ credential: 'safe' }),
    }),
  ),
  { credential: 'safe' },
)

await expectRequestError(
  new Request('https://identity.example/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  }),
)
await expectRequestError(
  new Request('https://identity.example/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' },
    body: '{}',
  }),
)
await expectRequestError(
  new Request('https://identity.example/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '[]',
  }),
)
await expectRequestError(
  new Request('https://identity.example/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: new Uint8Array([0xff]),
  }),
)

let cancelled = false
const chunks = [new Uint8Array(40 * 1024), new Uint8Array(30 * 1024)]
const oversizedStream = new ReadableStream({
  pull(controller) {
    const chunk = chunks.shift()
    if (chunk) controller.enqueue(chunk)
    else controller.close()
  },
  cancel() {
    cancelled = true
  },
})
await expectRequestError(
  new Request('https://identity.example/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: oversizedStream,
    duplex: 'half',
  }),
)
assert.equal(cancelled, true, 'oversized streamed bodies must be cancelled at the byte boundary')

console.log('passkey HTTP body boundary tests passed')
