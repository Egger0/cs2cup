import assert from 'node:assert/strict'
import { bracketSize, firstRoundPairs, orderBySeed, seedPositions } from '../lib/seeding.ts'

const expectedPositions = new Map([
  [2, [1, 2]],
  [4, [1, 4, 2, 3]],
  [8, [1, 8, 4, 5, 2, 7, 3, 6]],
  [16, [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]],
])

for (const [size, expected] of expectedPositions) {
  assert.deepEqual(seedPositions(size), expected, `standard seed positions for size ${size}`)
}

assert.equal(bracketSize(2), 2)
assert.equal(bracketSize(4), 4)
assert.equal(bracketSize(6), 8)
assert.equal(bracketSize(16), 16)

for (const invalid of [0, 1, 3, 6, 12, 16.5]) {
  assert.throws(() => seedPositions(invalid), RangeError, `reject invalid bracket size ${invalid}`)
}

for (const invalid of [-1, 0, 1, 2.5]) {
  assert.throws(() => bracketSize(invalid), RangeError, `reject invalid team count ${invalid}`)
}

const sixTeamPairs = firstRoundPairs(bracketSize(6))
const sixTeamByes = sixTeamPairs.filter(([a, b]) => a > 6 || b > 6)

assert.deepEqual(sixTeamPairs, [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6],
])
assert.deepEqual(sixTeamByes, [
  [1, 8],
  [2, 7],
])
assert.equal(sixTeamByes.length, 2)

const partialSeeds = [
  { id: 'first', seed: null },
  { id: 'explicit-four', seed: 4 },
  { id: 'second', seed: null },
  { id: 'explicit-one', seed: 1 },
  { id: 'third', seed: null },
  { id: 'fourth', seed: null },
]
assert.deepEqual(
  orderBySeed(partialSeeds).map(team => team.id),
  ['explicit-one', 'first', 'second', 'explicit-four', 'third', 'fourth'],
  'partial seed numbers keep their exact positions and fill gaps in input order',
)
assert.throws(
  () => orderBySeed([{ seed: 1 }, { seed: 1 }]),
  RangeError,
  'duplicate seeds are rejected',
)
assert.throws(
  () => orderBySeed([{ seed: 3 }, { seed: null }]),
  RangeError,
  'out-of-range seeds are rejected',
)

console.log('seeding tests passed')
