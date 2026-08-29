import type { ObjectStore } from './contracts.ts'
import { contentTypeForStorageKey } from './key.ts'
import {
  getLocalObject,
  putLocalObject,
  removeLocalObject,
} from '../local-object-storage.ts'

function ownedArrayBuffer(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy.buffer
}

export function createLocalObjectStore(root: string): ObjectStore {
  return {
    async put(key, body) {
      await putLocalObject(root, key, body)
      return { key }
    },

    async get(key) {
      try {
        const body = await getLocalObject(root, key)
        return {
          body: ownedArrayBuffer(body),
          contentType: contentTypeForStorageKey(key),
          size: body.byteLength,
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },

    delete(key) {
      return removeLocalObject(root, key)
    },
  }
}
