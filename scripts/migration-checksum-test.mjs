import assert from 'node:assert/strict'

import {
  migrationChecksum,
  normalizeMigrationSql,
} from './migration-checksum.mjs'

const lf = 'select 1;\nselect 2;\n'
const crlf = 'select 1;\r\nselect 2;\r\n'
const cr = 'select 1;\rselect 2;\r'

assert.equal(normalizeMigrationSql(crlf), lf)
assert.equal(normalizeMigrationSql(cr), lf)
assert.equal(migrationChecksum(crlf), migrationChecksum(lf))
assert.equal(migrationChecksum(cr), migrationChecksum(lf))
assert.notEqual(migrationChecksum('select 1;\n'), migrationChecksum(lf))

console.log('migration checksum tests passed')
