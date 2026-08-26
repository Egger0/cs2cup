import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface LegacyPhoto {
  id: number
  data: { url: string; sort?: number; caption?: string; edition: string }
}

const EDITION_TO_SLUG: Record<string, string> = {
  '2022第一届春季宁理杯': '2022-spring-nlc',
  '2022第二届秋季宁理杯': '2022-autumn-nlc',
  '2025第三届宁理杯': '2025-nlc',
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

function parseDataUrl(value: string) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(value)
  if (!match) return null
  const [, mime, base64] = match
  if (!mime || !base64) return null
  return { mime, buffer: Buffer.from(base64, 'base64') }
}

function jpegSize(buffer: Buffer) {
  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === undefined) break
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + buffer.readUInt16BE(offset + 2)
  }
  return null
}

function pngSize(buffer: Buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function dimensions(mime: string, buffer: Buffer) {
  if (mime === 'image/jpeg') return jpegSize(buffer)
  if (mime === 'image/png') return pngSize(buffer)
  return null
}

async function readLegacyPhotos(baseUrl: string, key: string) {
  const response = await fetch(`${baseUrl}/gallery?select=id,data`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`gallery read failed: ${response.status}`)
  return (await response.json()) as LegacyPhoto[]
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const outputDir = process.env.PHOTO_OUTPUT_DIR ?? 'migration-output/photos'
  const baseUrl = process.env.LEGACY_RDB_BASE_URL
  const key = process.env.LEGACY_ANON_KEY

  if (!baseUrl || !key) {
    throw new Error('LEGACY_RDB_BASE_URL and LEGACY_ANON_KEY must be set')
  }

  const photos = await readLegacyPhotos(baseUrl, key)
  await mkdir(outputDir, { recursive: true })

  const ordered = [...photos].sort(
    (x, y) => (x.data.sort ?? x.id) - (y.data.sort ?? y.id) || x.id - y.id,
  )
  const nextOrder = new Map<string, number>()

  const statements: string[] = []
  let migrated = 0
  let skipped = 0

  for (const photo of ordered) {
    const slug = EDITION_TO_SLUG[photo.data.edition]
    if (!slug) {
      console.warn(`skip ${photo.id}: unknown edition ${photo.data.edition}`)
      skipped += 1
      continue
    }

    const parsed = parseDataUrl(photo.data.url)
    if (!parsed) {
      console.warn(`skip ${photo.id}: not a data url`)
      skipped += 1
      continue
    }

    const ext = MIME_TO_EXT[parsed.mime] ?? 'bin'
    const size = dimensions(parsed.mime, parsed.buffer)
    if (!size) {
      console.warn(`skip ${photo.id}: cannot read dimensions of ${parsed.mime}`)
      skipped += 1
      continue
    }

    const storageKey = `${slug}/${photo.id}.${ext}`
    if (!dryRun) {
      await mkdir(join(outputDir, slug), { recursive: true })
      await writeFile(join(outputDir, storageKey), parsed.buffer)
    }

    const sortOrder = nextOrder.get(slug) ?? 0
    nextOrder.set(slug, sortOrder + 1)

    statements.push(
      `insert into public.photo (tournament_id, storage_key, width, height, caption, sort_order)\n` +
        `select id, '${storageKey}', ${size.width}, ${size.height}, ` +
        `${photo.data.caption ? `'${photo.data.caption.replace(/'/g, "''")}'` : 'null'}, ` +
        `${sortOrder} from public.tournament where slug = '${slug}'\n` +
        `on conflict do nothing;`,
    )

    console.log(
      `${storageKey}  ${size.width}x${size.height}  ${(parsed.buffer.length / 1024).toFixed(0)}KB`,
    )
    migrated += 1
  }

  if (!dryRun) {
    await writeFile(join(outputDir, '..', '004_photos.sql'), `${statements.join('\n\n')}\n`)
  }

  console.log(`\nmigrated ${migrated}, skipped ${skipped}${dryRun ? ' (dry run)' : ''}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
