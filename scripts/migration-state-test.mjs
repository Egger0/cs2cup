import assert from 'node:assert/strict'

import {
  verifyAppendOnlyMigrations,
  verifyUniqueMigrationVersions,
} from './migration-state.mjs'

assert.doesNotThrow(() =>
  verifyUniqueMigrationVersions('expand', ['001_schema.sql', '002_access.sql']),
)
assert.throws(
  () => verifyUniqueMigrationVersions('expand', ['014_first.sql', '014_second.sql']),
  /version 014 is not unique/,
)

const repository = new Map([
  ['014_contract.sql', {}],
  ['015_late_backfill.sql', {}],
  ['017_contract.sql', {}],
  ['018_next.sql', {}],
])
assert.throws(
  () =>
    verifyAppendOnlyMigrations(
      'contract',
      new Map([
        ['014_contract.sql', 'checksum'],
        ['017_contract.sql', 'checksum'],
      ]),
      repository,
    ),
  /015_late_backfill\.sql is not newer than applied version 017/,
)
assert.doesNotThrow(() =>
  verifyAppendOnlyMigrations(
    'contract',
    new Map([
      ['014_contract.sql', 'checksum'],
      ['015_late_backfill.sql', 'checksum'],
      ['017_contract.sql', 'checksum'],
    ]),
    repository,
  ),
)

console.log('migration state tests passed')
