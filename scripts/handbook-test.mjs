import assert from 'node:assert/strict'
import {
  HANDBOOK_ACCEPT,
  formatFileSize,
  handbookFileMatches,
  handbookFileType,
} from '../lib/handbook-file.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const pdf = new TextEncoder().encode('%PDF-1.7 body')
const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])

assert.equal(handbookFileType('Season Handbook.PDF'), 'pdf')
assert.equal(handbookFileType('budget.xlsx'), 'xlsx')
assert.equal(handbookFileType('run.exe'), null)
assert.equal(handbookFileType('handbook'), null)
assert.ok(HANDBOOK_ACCEPT.includes('.docx'))

assert.equal(handbookFileMatches('pdf', pdf), true)
assert.equal(handbookFileMatches('pdf', zip), false)
assert.equal(handbookFileMatches('docx', zip), true)
assert.equal(handbookFileMatches('docx', pdf), false)
assert.equal(handbookFileMatches('md', new TextEncoder().encode('# Rules')), true)
assert.equal(handbookFileMatches('txt', Uint8Array.from([0x61, 0x00, 0x62])), false)
assert.equal(handbookFileMatches('txt', Uint8Array.from([0xff, 0xfe, 0xfd])), false)

assert.equal(formatFileSize(300), '1 KB')
assert.equal(formatFileSize(512 * 1024), '512 KB')
assert.equal(formatFileSize(2.5 * 1024 * 1024), '2.5 MB')

const database = await createMigratedDatabase()
try {
  const insert = database.prepare(
    'INSERT INTO handbook_document (kind, title, storage_key, file_name, byte_size, url) VALUES (?, ?, ?, ?, ?, ?)',
  )
  insert.run('handbook', 'Season handbook', 'handbook/a.pdf', 'handbook.pdf', 1024, null)
  insert.run('template', 'Registration sheet', null, null, null, 'https://docs.qq.com/doc/x')

  for (const row of [
    ['guide', 'Unknown kind', null, null, null, 'https://example.com'],
    ['handbook', '', null, null, null, 'https://example.com'],
    ['handbook', 'Both sources', 'handbook/b.pdf', 'b.pdf', 10, 'https://example.com'],
    ['handbook', 'No source', null, null, null, null],
    ['handbook', 'Plain HTTP', null, null, null, 'http://example.com'],
    ['handbook', 'Empty file', 'handbook/c.pdf', 'c.pdf', 0, null],
    ['handbook', 'Duplicate key', 'handbook/a.pdf', 'a.pdf', 10, null],
  ]) {
    assert.throws(() => insert.run(...row), row[1])
  }
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM handbook_document').get().n, 2)
} finally {
  database.close()
}

console.log('handbook tests passed')
