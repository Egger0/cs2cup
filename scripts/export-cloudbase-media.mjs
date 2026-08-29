import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import cloudbase from '@cloudbase/js-sdk/app'
import { registerStorage } from '@cloudbase/js-sdk/storage'

registerStorage(cloudbase)

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const source = resolve(process.argv[2] || 'migration-output/cloudbase-export')
  const output = resolve(process.argv[3] || join(source, 'media'))
  const environment = required('LEGACY_CLOUDBASE_ENV_ID')
  const accessKey = required('LEGACY_CLOUDBASE_ADMIN_KEY')
  const bucketName = process.env.LEGACY_CLOUDBASE_BUCKET?.trim() || 'cs2cup-photos'
  const region = process.env.LEGACY_CLOUDBASE_REGION?.trim() || 'ap-shanghai'
  const photos = JSON.parse(await readFile(join(source, 'photo.json'), 'utf8'))
  if (!Array.isArray(photos)) throw new Error('photo.json must contain an array')
  const bucket = cloudbase.init({ env: environment, region, accessKey }).storage.from(bucketName)
  const objects = []

  for (const photo of photos) {
    const key = photo?.storage_key
    if (typeof key !== 'string' || !key) throw new Error('photo export contains an invalid storage key')
    const downloaded = await bucket.download(key)
    if (downloaded.error) throw new Error(`download failed for ${key}: ${downloaded.error.message}`)
    const body = Buffer.from(await downloaded.data.arrayBuffer())
    const target = join(output, ...key.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body, { mode: 0o600 })
    objects.push({ key, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') })
    console.log(`${key}: ${body.length} bytes`)
  }

  await writeFile(join(source, 'media-manifest.json'), `${JSON.stringify({ format: 1, objects }, null, 2)}\n`, { mode: 0o600 })
  console.log(`manifest: ${join(source, 'media-manifest.json')}`)
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'media export failed'); process.exit(1) })
