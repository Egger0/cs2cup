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
