import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  getLocalObject,
  putLocalObject,
  removeLocalObject,
  resolveLocalObjectPath,
} from '../lib/local-object-storage.ts'
import { imageSize, sniffMime } from '../lib/image.ts'
import { createPhotoStorageKey } from '../lib/photo-storage-key.ts'

const root = await mkdtemp(join(tmpdir(), 'cs2cup-photo-storage-test-'))
const outsideSentinel = `${root}-outside.txt`

try {
  await writeFile(outsideSentinel, 'outside')
  const body = Buffer.from('private photo payload')
  await putLocalObject(root, 'event/photo.webp', body)
  assert.deepEqual(await getLocalObject(root, 'event/photo.webp'), body)
  await removeLocalObject(root, 'event/photo.webp')
  await removeLocalObject(root, 'event/photo.webp')

  const invalidKeys = [
    '',
    '/absolute.jpg',
    '../outside.txt',
    'event/../../outside.txt',
    '..\\outside.txt',
    'event\\..\\outside.txt',
    'event//photo.jpg',
    'event/./photo.jpg',
    'event/photo\u0000.jpg',
    'C:\\outside.jpg',
  ]
  for (const key of invalidKeys) {
    assert.throws(() => resolveLocalObjectPath(root, key), /Invalid photo storage key/)
    await assert.rejects(putLocalObject(root, key, body), /Invalid photo storage key/)
    await assert.rejects(getLocalObject(root, key), /Invalid photo storage key/)
    await assert.rejects(removeLocalObject(root, key), /Invalid photo storage key/)
  }
  assert.equal(await readFile(outsideSentinel, 'utf8'), 'outside')

  const generatedKeys = new Set(
    Array.from({ length: 128 }, () => createPhotoStorageKey('summer-cup', 'webp')),
  )
  assert.equal(generatedKeys.size, 128)
  for (const key of generatedKeys) {
    assert.match(
      key,
      /^summer-cup\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/,
    )
  }
  assert.throws(
    () => createPhotoStorageKey('../outside', 'jpg'),
    /Invalid photo storage key/,
  )

  const pngBacking = new Uint8Array(32)
  const png = pngBacking.subarray(4, 28)
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  png.set([0x49, 0x48, 0x44, 0x52], 12)
  const pngView = new DataView(png.buffer, png.byteOffset, png.byteLength)
  pngView.setUint32(16, 640)
  pngView.setUint32(20, 360)
  assert.equal(sniffMime(png), 'image/png')
  assert.deepEqual(imageSize('image/png', png), { width: 640, height: 360 })

  const jpeg = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80,
    0x03, 0x01, 0x11, 0x00,
  ])
  assert.equal(sniffMime(jpeg), 'image/jpeg')
  assert.deepEqual(imageSize('image/jpeg', jpeg), { width: 640, height: 360 })

  const jpegWithFill = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80,
    0x03, 0x01, 0x11, 0x00,
  ])
  assert.deepEqual(
    imageSize('image/jpeg', jpegWithFill),
    { width: 640, height: 360 },
  )

  const webp = new Uint8Array(30)
  webp.set(new TextEncoder().encode('RIFF'), 0)
  webp.set(new TextEncoder().encode('WEBPVP8X'), 8)
  webp[24] = 0x7f
  webp[27] = 0x3f
  assert.equal(sniffMime(webp), 'image/webp')
  assert.deepEqual(imageSize('image/webp', webp), { width: 128, height: 64 })

  const malformedPng = Uint8Array.from(png, byte => byte)
  malformedPng[12] = 0
  const oversizedMalformedJpeg = new Uint8Array(10 * 1024 * 1024)
  oversizedMalformedJpeg.set([0xff, 0xd8])
  const malformedImages = [
    ['image/png', new Uint8Array()],
    ['image/png', png.subarray(0, 20)],
    ['image/png', malformedPng],
    ['image/jpeg', jpeg.subarray(0, 9)],
    ['image/jpeg', oversizedMalformedJpeg],
    ['image/webp', webp.subarray(0, 29)],
  ]
  for (const [mime, malformed] of malformedImages) {
    assert.doesNotThrow(() => imageSize(mime, malformed))
    assert.equal(imageSize(mime, malformed), null)
  }

  const actionSource = await readFile(
    new URL('../app/admin/(console)/_actions.ts', import.meta.url),
    'utf8',
  )
  assert.match(
    actionSource,
    /export async function deletePhotoAndFile\(id: number\)/,
    'photo deletion must accept only an id from the client',
  )
  assert.match(
    actionSource,
    /const photo = await adminGetPhoto\(id\)/,
    'photo deletion must resolve the authoritative storage key server-side',
  )

  console.log('photo storage boundary tests passed')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(outsideSentinel, { force: true })
}
