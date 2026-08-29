import type { ObjectStore } from './contracts.ts'
import { assertStorageKey, safeContentTypeForStorageKey } from './key.ts'

export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array>
  size: number
  httpMetadata?: { contentType?: string }
}

export interface R2BucketLike {
  put(
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown | null>
  get(key: string): Promise<R2ObjectBodyLike | null>
  delete(key: string): Promise<void>
}

export function createR2ObjectStore(bucket: R2BucketLike): ObjectStore {
  return {
    async put(key, body, contentType) {
      assertStorageKey(key)
      const stored = await bucket.put(key, body, {
        httpMetadata: {
          contentType: safeContentTypeForStorageKey(key, contentType),
        },
      })
      if (!stored) throw new Error('R2 object upload failed')
      return { key }
    },

    async get(key) {
      assertStorageKey(key)
      const object = await bucket.get(key)
      if (!object) return null
      return {
        body: object.body,
        contentType: safeContentTypeForStorageKey(
          key,
          object.httpMetadata?.contentType,
        ),
        size: object.size,
      }
    },

    async delete(key) {
      assertStorageKey(key)
      await bucket.delete(key)
    },
  }
}
