import { database, databaseOperation } from '@/lib/database'
import { servePhotoObject } from '@/lib/photo-media-response'

async function isPublishedPhoto(storageKey: string) {
  return databaseOperation('media:find-public-photo', async () => {
    const sql = database()
    const rows = await sql<{ found: boolean }[]>`
      select exists (
        select 1
        from public.photo_public photo
        join public.tournament tournament on tournament.id = photo.tournament_id
        where photo.storage_key = ${storageKey}
          and tournament.status <> 'draft'
      ) as found
    `
    return rows[0]?.found === true
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params
  return servePhotoObject(key, isPublishedPhoto)
}
