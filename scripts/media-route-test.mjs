import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../app/media/[...key]/route.ts', import.meta.url), 'utf8')

assert.match(source, /parseVariantKey/)
assert.match(source, /variantStemMatches/)
assert.match(source, /public, max-age=31536000, immutable/)
assert.match(source, /PRIVATE_NO_STORE_HEADERS/)
assert.match(source, /ilike/)

const config = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8')
assert.doesNotMatch(
  config,
  /'\/media\/:path\*'/,
  'media caching is decided per photo in the route handler, not by a static header rule',
)

console.log('media route tests passed')
