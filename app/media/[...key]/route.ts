import { posix } from 'node:path'
import { getCurrentAdmin } from '@/lib/auth'
import { selectRow } from '@/lib/rdb'
import { getObject } from '@/lib/storage'

function notFound() {
  return new Response('not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}

async function canReadPhoto(storageKey: string) {
  const published = await selectRow<{ id: number }>('photo_public', {
    select: 'id',
    filters: { storage_key: `eq.${storageKey}` },
    revalidate: false,
  }).catch(() => null)
  if (published) return true

  const admin = await getCurrentAdmin().catch(() => null)
  if (!admin) return false

  const privatePhoto = await selectRow<{ id: number }>('photo', {
    select: 'id',
    filters: { storage_key: `eq.${storageKey}` },
    credential: 'admin',
    revalidate: false,
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
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return notFound()
  }
}
