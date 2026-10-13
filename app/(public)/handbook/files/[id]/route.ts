import { findHandbookDocument } from '@/lib/handbook'
import { HANDBOOK_FILE_TYPES, handbookFileType } from '@/lib/handbook-file'
import { getObject } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id)
  const document = Number.isSafeInteger(id) && id > 0 ? await findHandbookDocument(id) : null
  const type = document?.fileName ? handbookFileType(document.fileName) : null
  if (!document?.storageKey || !document.fileName || !type) {
    return new Response('not found', { status: 404 })
  }

  try {
    const file = await getObject(document.storageKey)
    return new Response(new Uint8Array(file.body).buffer, {
      headers: {
        'Content-Type': HANDBOOK_FILE_TYPES[type].mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}
