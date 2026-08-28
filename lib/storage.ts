import 'server-only'
import cloudbase from '@cloudbase/js-sdk/app'
import { registerStorage } from '@cloudbase/js-sdk/storage'
import {
  resolveCloudBaseEnvironmentId,
  resolveCloudBaseRegion,
} from './cloudbase-environment'
import { resolvePhotoLocalRoot } from './photo-storage-config'
import {
  assertStorageKey,
  getLocalObject,
  putLocalObject,
  removeLocalObject,
} from './local-object-storage'

export interface StoredFile {
  key: string
}

export interface StoredObject {
  body: Uint8Array
  contentType: string
}

const LOCAL_ROOT = resolvePhotoLocalRoot()
const DEFAULT_BUCKET = 'cs2cup-photos'

registerStorage(cloudbase)

export const LOCAL_UPLOAD_ROOT = LOCAL_ROOT

function driver() {
  const value = process.env.PHOTO_UPLOAD_DRIVER ?? 'local'
  if (value === 'local' || value === 'cloudbase') return value
  throw new Error('PHOTO_UPLOAD_DRIVER must be local or cloudbase')
}

function bucketName() {
  return process.env.PHOTO_BUCKET ?? DEFAULT_BUCKET
}

function contentTypeFor(key: string) {
  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

function cloudBucket() {
  const env = resolveCloudBaseEnvironmentId()
  const accessKey = process.env.CLOUDBASE_ADMIN_KEY
  if (!env || !accessKey) throw new Error('CloudBase storage is not configured')

  return cloudbase
    .init({ env, region: resolveCloudBaseRegion(), accessKey })
    .storage.from(bucketName())
}

export function uploadsEnabled() {
  if (driver() === 'local') return true
  return Boolean(resolveCloudBaseEnvironmentId() && process.env.CLOUDBASE_ADMIN_KEY)
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  assertStorageKey(key)
  if (driver() === 'local') {
    await putLocalObject(LOCAL_ROOT, key, body)
    return { key }
  }

  const result = await cloudBucket().upload(key, body, { contentType })
  if (result.error) throw new Error(`CloudBase storage upload failed: ${result.error.message}`)
  return { key }
}

export async function getObject(key: string): Promise<StoredObject> {
  assertStorageKey(key)
  if (driver() === 'local') {
    return {
      body: new Uint8Array(await getLocalObject(LOCAL_ROOT, key)),
      contentType: contentTypeFor(key),
    }
  }

  const result = await cloudBucket().download(key)
  if (result.error) throw new Error(`CloudBase storage download failed: ${result.error.message}`)
  return {
    body: new Uint8Array(await result.data.arrayBuffer()),
    contentType: result.data.type || contentTypeFor(key),
  }
}

export async function removeObject(key: string) {
  assertStorageKey(key)
  if (driver() === 'local') {
    await removeLocalObject(LOCAL_ROOT, key)
    return
  }

  const result = await cloudBucket().remove([key])
  if (result.error) throw new Error(`CloudBase storage delete failed: ${result.error.message}`)
}
