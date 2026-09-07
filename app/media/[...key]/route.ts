import { posix } from 'node:path'
import { getCurrentPlatformOwner, getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/http-cache'
import { parseVariantKey, variantStemMatches } from '@/lib/photo-variants'
import { selectPrivateRow, selectPrivateRows, selectPublicRow, selectPublicRows } from '@/lib/rdb'
import { getObject } from '@/lib/storage'

interface StorageKeyRow {
  storage_key: string
}

const PUBLIC_IMMUTABLE_HEADERS = Object.freeze({
  'Cache-Control': 'public, max-age=31536000, immutable',
})

function notFound() {
  return new Response('not found', {
    status: 404,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

async function findPhoto(published: boolean, storageKey: string) {
  const filters = { storage_key: `eq.${storageKey}` }
  const direct = published
    ? await selectPublicRow<StorageKeyRow>('photo_public', { filters }).catch(() => null)
    : await selectPrivateRow<StorageKeyRow>('photo', { filters }).catch(() => null)
  if (direct) return true

  const variant = parseVariantKey(storageKey)
  if (!variant) return false

  const variantFilters = { storage_key: `ilike.${variant.stem}.*` }
  const candidates = published
    ? await selectPublicRows<StorageKeyRow>('photo_public', { filters: variantFilters }).catch(
        () => [],
      )
    : await selectPrivateRows<StorageKeyRow>('photo', { filters: variantFilters }).catch(() => [])
  return candidates.some(row => variantStemMatches(row.storage_key, variant.stem))
}

async function canReadPhoto(storageKey: string) {
  if (await findPhoto(true, storageKey)) return 'published' as const

  const [admin, unifiedOwner] = await Promise.all([
    getCurrentPlatformOwner().catch(() => null),
    getCurrentUnifiedPlatformOwner().catch(() => null),
  ])
  if (!admin && !unifiedOwner) return null

  return (await findPhoto(false, storageKey)) ? ('private' as const) : null
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

  const access = await canReadPhoto(relative)
  if (!access) {
    return notFound()
  }

  try {
    const file = await getObject(relative)
    return new Response(new Uint8Array(file.body).buffer, {
      headers: {
        'Content-Type': file.contentType,
        ...(access === 'published' ? PUBLIC_IMMUTABLE_HEADERS : PRIVATE_NO_STORE_HEADERS),
      },
    })
  } catch {
    return notFound()
  }
}
