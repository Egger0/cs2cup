import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(
  new URL('../components/domain/PosterWall.tsx', import.meta.url),
  'utf8',
)

assert.doesNotMatch(source, /\{poster\.width\}×\{poster\.height\}/)
assert.match(source, /srcSet/)
assert.match(source, /sizes=/)
assert.match(source, /loading="lazy"/)
assert.match(source, /decoding="async"/)
assert.match(source, /aspectRatio/)

console.log('poster wall tests passed')
