import assert from 'node:assert/strict'
import {
  VARIANT_WIDTHS,
  parseVariantKey,
  plannedVariantWidths,
  variantStemMatches,
  variantStorageKey,
} from '../lib/photo-variants.ts'

assert.deepEqual([...VARIANT_WIDTHS], [480, 960, 1600, 2560])

assert.equal(variantStorageKey('2026-nlc/abc.webp', 960), '2026-nlc/abc.960.webp')
assert.equal(variantStorageKey('2026-nlc/abc.jpg', 480), '2026-nlc/abc.480.webp')

assert.deepEqual(parseVariantKey('2026-nlc/abc.960.webp'), { stem: '2026-nlc/abc', width: 960 })
assert.equal(parseVariantKey('2026-nlc/abc.webp'), null)
assert.equal(parseVariantKey('2026-nlc/abc.960.jpg'), null)
assert.equal(parseVariantKey('2026-nlc/abc.0.webp'), null)

assert.deepEqual(plannedVariantWidths(2560), [480, 960, 1600, 2560])
assert.deepEqual(plannedVariantWidths(1200), [480, 960])
assert.deepEqual(plannedVariantWidths(300), [480])

assert.equal(variantStemMatches('x/a_c.webp', 'x/a_c'), true)
assert.equal(variantStemMatches('x/a_c.960.webp', 'x/a_c'), true)
assert.equal(variantStemMatches('x/abc.webp', 'x/a_c'), false)
assert.equal(variantStemMatches('x/a_cd.webp', 'x/a_c'), false)
assert.equal(variantStemMatches('x/a_c', 'x/a_c'), false)

console.log('photo variant helpers passed')
