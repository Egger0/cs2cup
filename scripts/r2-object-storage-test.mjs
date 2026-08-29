import assert from 'node:assert/strict'

import { createR2ObjectStore } from '../lib/object-storage/r2.ts'
import {
  assertStorageKey,
  contentTypeForStorageKey,
  MAX_STORAGE_KEY_LENGTH,
  safeContentTypeForStorageKey,
} from '../lib/object-storage/key.ts'
import { resolveStorageDriver } from '../lib/storage.ts'

assert.equal(resolveStorageDriver({ NODE_ENV: 'development' }), 'local')
assert.equal(resolveStorageDriver({ PHOTO_UPLOAD_DRIVER: 'r2' }), 'r2')
assert.throws(
  () => resolveStorageDriver({ NODE_ENV: 'production' }),
  /required in production/,
)
assert.throws(
  () => resolveStorageDriver({ PHOTO_UPLOAD_DRIVER: 'legacy' }),
  /must be local or r2/,
)

const calls = []
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array([1, 2, 3]))
    controller.close()
  },
})
const bucket = {
  async put(key, body, options) {
    calls.push({ method: 'put', key, body, options })
    return { key }
  },
  async get(key) {
    calls.push({ method: 'get', key })
    if (key === 'missing.webp') return null
    return {
      body: stream,
      size: 3,
      httpMetadata: key === 'fallback.webp'
        ? {}
        : { contentType: key === 'unsafe.webp' ? 'text/html' : 'image/webp' },
    }
  },
  async delete(key) {
    calls.push({ method: 'delete', key })
  },
}

const store = createR2ObjectStore(bucket)
const bytes = new Uint8Array([1, 2, 3])
assert.deepEqual(
  await store.put('summer/photo.webp', bytes, 'image/webp'),
  { key: 'summer/photo.webp' },
)
assert.deepEqual(calls[0], {
  method: 'put',
  key: 'summer/photo.webp',
  body: bytes,
  options: { httpMetadata: { contentType: 'image/webp' } },
})
await store.put('summer/unsafe.webp', bytes, 'text/html')
assert.deepEqual(calls[1], {
  method: 'put',
  key: 'summer/unsafe.webp',
  body: bytes,
  options: { httpMetadata: { contentType: 'image/webp' } },
})

const stored = await store.get('summer/photo.webp')
assert.equal(stored?.body, stream)
assert.equal(stored?.contentType, 'image/webp')
assert.equal(stored?.size, 3)
assert.equal((await store.get('fallback.webp'))?.contentType, 'image/webp')
assert.equal((await store.get('unsafe.webp'))?.contentType, 'image/webp')
assert.equal(await store.get('missing.webp'), null)

await store.delete('summer/photo.webp')
assert.deepEqual(calls.at(-1), { method: 'delete', key: 'summer/photo.webp' })

for (const key of ['', '../photo.webp', 'summer/../photo.webp', 'a//b.webp']) {
  assert.throws(() => assertStorageKey(key), /Invalid photo storage key/)
  await assert.rejects(store.get(key), /Invalid photo storage key/)
}
assert.throws(
  () => assertStorageKey('a'.repeat(MAX_STORAGE_KEY_LENGTH + 1)),
  /Invalid photo storage key/,
)
assert.equal(contentTypeForStorageKey('summer/photo.jpg'), 'image/jpeg')
assert.equal(contentTypeForStorageKey('summer/photo.bin'), 'application/octet-stream')
assert.equal(
  safeContentTypeForStorageKey('summer/photo.webp', 'text/html'),
  'image/webp',
)

console.log('R2 object storage contract tests passed')
