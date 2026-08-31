import assert from 'node:assert/strict'

import { splitFilter } from '../lib/rdb-filter.ts'

assert.deepEqual(splitFilter('eq.2022/53d02f05-5d76-4f77-beeb-5dd102596604.jpg'), [
  'eq',
  '2022/53d02f05-5d76-4f77-beeb-5dd102596604.jpg',
])
assert.deepEqual(splitFilter('ilike.*spring.cup*'), ['ilike', '*spring.cup*'])
assert.deepEqual(splitFilter('eq'), ['eq', ''])

console.log('RDB filter tests passed')
