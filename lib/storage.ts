import 'server-only'
import { cloudflareBindings } from './cloudflare-bindings'
import { assertStorageKey } from './storage-key'

export interface StoredFile { key: string }
export interface StoredObject { body: Uint8Array; contentType: string }

function contentTypeFor(key: string) {
  const extension = key.split('.').pop()?.toLowerCase()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return 'application/octet-stream'
}

export function uploadsEnabled() {
  try { return Boolean(cloudflareBindings().media) } catch { return false }
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  assertStorageKey(key)
  await cloudflareBindings().media.put(key, body, { httpMetadata: { contentType } })
  return { key }
}

export async function getObject(key: string): Promise<StoredObject> {
  assertStorageKey(key)
  const object = await cloudflareBindings().media.get(key) as {
    body?: ReadableStream<Uint8Array>
    httpMetadata?: { contentType?: string }
  } | null
  if (!object?.body) throw new Error('R2 object not found')
  const response = new Response(object.body)
  return { body: new Uint8Array(await response.arrayBuffer()), contentType: object.httpMetadata?.contentType || contentTypeFor(key) }
}

export async function removeObject(key: string) {
  assertStorageKey(key)
  await cloudflareBindings().media.delete(key)
}
