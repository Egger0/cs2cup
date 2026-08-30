import assert from 'node:assert/strict'

import { fittedImageSize } from '../lib/client-image.ts'

assert.deepEqual(fittedImageSize(1280, 717), { width: 1280, height: 717 })
assert.deepEqual(fittedImageSize(3472, 4624), { width: 1922, height: 2560 })
assert.deepEqual(fittedImageSize(4624, 3472), { width: 2560, height: 1922 })

console.log('image upload tests passed')
