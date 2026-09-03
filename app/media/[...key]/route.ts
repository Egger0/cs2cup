import { posix } from 'node:path'
import { getCurrentPlatformOwner, getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/http-cache'
import { selectPrivateRow, selectPublicRow } from '@/lib/rdb'
import { getObject } from '@/lib/storage'

function notFound() {
  return new Response('not found', {
    status: 404,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

async function canReadPhoto(storageKey: string) {
  const published = await selectPublicRow<{ id: number }>('photo_public', {
    filters: { storage_key: `eq.${storageKey}` },
  }).catch(() => null)
  if (published) return true

  const [admin, unifiedOwner] = await Promise.all([
    getCurrentPlatformOwner().catch(() => null),
    getCurrentUnifiedPlatformOwner().catch(() => null),
  ])
  if (!admin && !unifiedOwner) return false

  const privatePhoto = await selectPrivateRow<{ id: number }>('photo', {
    filters: { storage_key: `eq.${storageKey}` },
  }).catch(() => null)
  return Boolean(privatePhoto)
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params
  const relative = posix.normalize(key.join('/'))
  if (
    relative === '.' ||
    relative === '..' ||
    relative.startsWith('../') ||
    relative.startsWith('/')
  ) {
    return notFound()
  }

  if (!(await canReadPhoto(relative))) {
    return notFound()
  }

  try {
    const file = await getObject(relative)
    return new Response(new Uint8Array(file.body).buffer, {
      headers: {
        'Content-Type': file.contentType,
        ...PRIVATE_NO_STORE_HEADERS,
      },
    })
  } catch {
    return notFound()
  }
}
