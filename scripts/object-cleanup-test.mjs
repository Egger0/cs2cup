import assert from 'node:assert/strict'

import { deleteRecordThenObjects } from '../lib/object-cleanup.ts'

const events = []
const failures = await deleteRecordThenObjects(
  ['first.webp', 'second.webp', 'third.webp'],
  async () => events.push('database'),
  async key => {
    events.push(key)
    if (key === 'second.webp') throw new Error('injected object failure')
  },
)
assert.deepEqual(events, ['database', 'first.webp', 'second.webp', 'third.webp'])
assert.deepEqual(
  failures.map(failure => failure.key),
  ['second.webp'],
)

const blockedEvents = []
await assert.rejects(
  deleteRecordThenObjects(
    ['must-not-delete.webp'],
    async () => {
      blockedEvents.push('database')
      throw new Error('injected database failure')
    },
    async key => blockedEvents.push(key),
  ),
  /injected database failure/,
)
assert.deepEqual(blockedEvents, ['database'])

console.log('database-first object cleanup tests passed')
