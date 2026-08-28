import assert from 'node:assert/strict'
import { join } from 'node:path'

import { resolvePhotoLocalRoot } from '../lib/photo-storage-config.ts'

const temporaryDirectory = join(process.cwd(), '.photo-storage-config-test')
const fallback = join(temporaryDirectory, 'cs2cup-photos')

assert.equal(resolvePhotoLocalRoot(undefined, temporaryDirectory), fallback)
assert.equal(resolvePhotoLocalRoot('', temporaryDirectory), fallback)
assert.equal(resolvePhotoLocalRoot('   ', temporaryDirectory), fallback)
assert.equal(resolvePhotoLocalRoot(` ${fallback} `, temporaryDirectory), fallback)
assert.throws(
  () => resolvePhotoLocalRoot('public/photos', temporaryDirectory),
  /must be an absolute path/,
)

console.log('photo storage configuration tests passed')
