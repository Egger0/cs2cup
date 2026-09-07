import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { fittedImageSize, scaledImageSize } from '../lib/client-image.ts'

assert.deepEqual(fittedImageSize(1280, 717), { width: 1280, height: 717 })
assert.deepEqual(fittedImageSize(3472, 4624), { width: 1922, height: 2560 })
assert.deepEqual(fittedImageSize(4624, 3472), { width: 2560, height: 1922 })

assert.deepEqual(scaledImageSize(2560, 1440, 960), { width: 960, height: 540 })
assert.deepEqual(scaledImageSize(1000, 2000, 480), { width: 480, height: 960 })
assert.deepEqual(scaledImageSize(400, 300, 960), { width: 400, height: 300 })

const clientImage = await readFile(new URL('../lib/client-image.ts', import.meta.url), 'utf8')
assert.match(clientImage, /export async function renderImageVariants/)
assert.match(clientImage, /blurDataUrl/)

const uploader = await readFile(
  new URL('../app/admin/(console)/photos/Uploader.tsx', import.meta.url),
  'utf8',
)
assert.match(uploader, /onSubmit=/)
assert.match(uploader, /formRef\.current\?\.reset\(\)/)
assert.match(uploader, /catch \{/)
assert.match(uploader, /已保留所选图片/)
assert.match(uploader, /disabled=\{pending\}/)
assert.match(uploader, /role=\{feedback\.ok \? 'status' : 'alert'\}/)

const photoRow = await readFile(
  new URL('../app/admin/(console)/photos/PhotoRow.tsx', import.meta.url),
  'utf8',
)
assert.match(photoRow, /confirm\(/)
assert.match(photoRow, /catch \{/)
assert.match(photoRow, /删除中…/)
assert.match(photoRow, /window\.alert\(result\.warning\)/)
assert.match(photoRow, /role=\{feedback\.tone === 'success' \? 'status' : 'alert'\}/)

console.log('image upload tests passed')
