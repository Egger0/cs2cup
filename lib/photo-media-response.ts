import 'server-only'

import { PRIVATE_NO_STORE_HEADERS } from './http-cache'
import { assertStorageKey } from './object-storage/key'
import { getObject } from './storage'

type PhotoAuthorization = (storageKey: string) => Promise<boolean>

function notFound() {
  return new Response('not found', {
    status: 404,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

function unavailable() {
  return new Response('service unavailable', {
    status: 503,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

export async function servePhotoObject(
  keyParts: string[],
  authorize: PhotoAuthorization,
) {
  const storageKey = keyParts.join('/')
  try {
    assertStorageKey(storageKey)
  } catch {
    return notFound()
  }

  try {
    if (!(await authorize(storageKey))) return notFound()
  } catch (error) {
    console.error('media authorization lookup failed', error)
    return unavailable()
  }

  try {
    const file = await getObject(storageKey)
    if (!file) return notFound()

    const headers = new Headers(PRIVATE_NO_STORE_HEADERS)
    headers.set('Content-Type', file.contentType)
    headers.set('X-Content-Type-Options', 'nosniff')
    if (file.size !== undefined) headers.set('Content-Length', String(file.size))
    return new Response(file.body, { headers })
  } catch (error) {
    console.error('media object read failed', error)
    return unavailable()
  }
}
