import 'server-only'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface StoredFile {
  key: string
}

const LOCAL_ROOT = process.env.PHOTO_LOCAL_ROOT ?? join(tmpdir(), 'cs2cup-photos')

export const LOCAL_UPLOAD_ROOT = LOCAL_ROOT

function driver() {
  return process.env.PHOTO_UPLOAD_DRIVER ?? 'local'
}

export function uploadsEnabled() {
  return driver() === 'local' || Boolean(process.env.COS_UPLOAD_URL)
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
  if (driver() === 'local') {
    const target = join(LOCAL_ROOT, key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)
    return { key }
  }

  const endpoint = process.env.COS_UPLOAD_URL
  if (!endpoint) throw new Error('COS_UPLOAD_URL is not set')

  const response = await fetch(`${endpoint.replace(/\/$/, '')}/${key}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      ...(process.env.COS_UPLOAD_TOKEN
        ? { Authorization: process.env.COS_UPLOAD_TOKEN }
        : {}),
    },
    body: new Uint8Array(body),
  })

  if (!response.ok) {
    throw new Error(`object storage rejected the upload: ${response.status}`)
  }

  return { key }
}

export async function removeObject(key: string) {
  if (driver() === 'local') {
    await unlink(join(LOCAL_ROOT, key)).catch(() => {})
    return
  }

  const endpoint = process.env.COS_UPLOAD_URL
  if (!endpoint) return
  await fetch(`${endpoint.replace(/\/$/, '')}/${key}`, {
    method: 'DELETE',
    headers: process.env.COS_UPLOAD_TOKEN
      ? { Authorization: process.env.COS_UPLOAD_TOKEN }
      : {},
  }).catch(() => {})
}
