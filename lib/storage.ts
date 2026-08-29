import 'server-only'

import { requireMediaBucket } from './cloudflare-bindings.ts'
import type {
  ObjectStore,
  StoredFile,
  StoredObject,
} from './object-storage/contracts.ts'
import { assertStorageKey } from './object-storage/key.ts'

export type { StoredFile, StoredObject }

export const STORAGE_DRIVERS = ['local', 'r2'] as const
export type StorageDriver = (typeof STORAGE_DRIVERS)[number]

interface StorageEnvironment {
  [name: string]: string | undefined
  NODE_ENV?: string
  PHOTO_UPLOAD_DRIVER?: string
}

export function resolveStorageDriver(
  environment: StorageEnvironment = process.env,
): StorageDriver {
  const configured = environment.PHOTO_UPLOAD_DRIVER
  if (!configured && environment.NODE_ENV === 'production') {
    throw new Error('PHOTO_UPLOAD_DRIVER is required in production')
  }
  if (!configured) return 'local'
  if ((STORAGE_DRIVERS as readonly string[]).includes(configured)) {
    return configured as StorageDriver
  }
  throw new Error('PHOTO_UPLOAD_DRIVER must be local or r2')
}

async function objectStore(): Promise<ObjectStore> {
  const selected = resolveStorageDriver()
  if (selected === 'r2') {
    const { createR2ObjectStore } = await import('./object-storage/r2.ts')
    return createR2ObjectStore(requireMediaBucket())
  }
  const [{ createLocalObjectStore }, { resolvePhotoLocalRoot }] = await Promise.all([
    import('./object-storage/local.ts'),
    import('./photo-storage-config.ts'),
  ])
  return createLocalObjectStore(resolvePhotoLocalRoot())
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<StoredFile> {
  assertStorageKey(key)
  return (await objectStore()).put(key, body, contentType)
}

export async function getObject(key: string): Promise<StoredObject | null> {
  assertStorageKey(key)
  return (await objectStore()).get(key)
}

export async function removeObject(key: string) {
  assertStorageKey(key)
  await (await objectStore()).delete(key)
}
