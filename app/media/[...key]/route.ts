import { posix } from 'node:path'
import { selectRow } from '@/lib/rdb'
import { getObject } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params
  const relative = posix.normalize(key.join('/'))
  if (
    relative === '.' ||
    relative === '..' ||
    relative.startsWith('../') ||
    relative.startsWith('/')
  ) {
    return new Response('not found', { status: 404 })
  }

  const photo = await selectRow<{ id: number }>('photo_public', {
    select: 'id',
    filters: { storage_key: `eq.${relative}` },
    revalidate: false,
  }).catch(() => null)
  if (!photo) {
    return new Response('not found', { status: 404 })
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
    return new Response('not found', { status: 404 })
  }
}
