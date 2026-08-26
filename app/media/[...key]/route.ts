import { readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve } from 'node:path'
import { LOCAL_UPLOAD_ROOT } from '@/lib/storage'

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (process.env.PHOTO_UPLOAD_DRIVER === 'cos') {
    return new Response('not found', { status: 404 })
  }

  const { key } = await params
  const relative = normalize(key.join('/'))
  if (relative.startsWith('..') || isAbsolute(relative)) {
    return new Response('not found', { status: 404 })
  }

  const root = resolve(LOCAL_UPLOAD_ROOT)
  const target = resolve(join(root, relative))
  if (!target.startsWith(root)) {
    return new Response('not found', { status: 404 })
  }

  try {
    const file = await readFile(target)
    const extension = relative.split('.').pop()?.toLowerCase() ?? ''
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': TYPES[extension] ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}
