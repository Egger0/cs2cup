import { requireAdmin } from '@/lib/auth'
import { database, databaseOperation } from '@/lib/database'
import { servePhotoObject } from '@/lib/photo-media-response'

async function isStoredPhoto(storageKey: string) {
  return databaseOperation('admin-media:find-photo', async () => {
    const sql = database()
    const rows = await sql<{ found: boolean }[]>`
      select exists (
        select 1
        from public.photo photo
        where photo.storage_key = ${storageKey}
      ) as found
    `
    return rows[0]?.found === true
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  await requireAdmin()
  const { key } = await params
  return servePhotoObject(key, isStoredPhoto)
}
