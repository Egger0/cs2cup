import assert from 'node:assert/strict'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

function expectDatabaseError(database, sql, expectedMessage) {
  assert.throws(
    () => database.exec(sql),
    error => {
      assert.match(error.message, new RegExp(expectedMessage))
      return true
    },
    `database should reject: ${sql}`,
  )
}

const opaque = character => character.repeat(43)
let nonceSeed = 0
const nextNonce = () => `n${String(++nonceSeed).padStart(42, '0')}`
const setHandle = (id, handle) =>
  `UPDATE identity_account
      SET public_handle = ${handle === null ? 'NULL' : `'${handle}'`},
          revision = revision + 1,
          write_nonce = '${nextNonce()}',
          updated_at = updated_at + 1
    WHERE id = '${id}'`
const ALPHA = opaque('A')
const BRAVO = opaque('B')

const database = await createMigratedDatabase()

try {
  for (const [id, handle] of [
    [ALPHA, opaque('a')],
    [BRAVO, opaque('b')],
  ]) {
    database.exec(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES ('${id}', '${handle}', 'Person', 'active', 'verified', 1, 1)`,
    )
  }

  const columns = new Set(
    database
      .prepare('PRAGMA table_info(identity_account)')
      .all()
      .map(column => column.name),
  )
  assert.equal(columns.has('public_handle'), true, 'an account may carry a public handle')

  database.exec(setHandle(ALPHA, 'aster'))
  expectDatabaseError(database, setHandle(BRAVO, 'aster'), 'UNIQUE')

  for (const rejected of [
    'As',
    'ASTER',
    'a',
    '-aster',
    'aster-',
    'a s',
    'aster_one',
    'admin',
    'players',
    'tournaments',
    'me',
    'a'.repeat(31),
  ]) {
    expectDatabaseError(database, setHandle(BRAVO, rejected), 'public handle')
  }

  database.exec(setHandle(BRAVO, 'flint-two'))
  database.exec(setHandle(BRAVO, null))
  assert.equal(
    database.prepare('SELECT COUNT(*) AS n FROM identity_account WHERE public_handle IS NULL').get()
      .n,
    1,
    'an account without a handle stays legal',
  )

  expectDatabaseError(
    database,
    `INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at,
       public_handle)
     VALUES ('${opaque('C')}', '${opaque('c')}', 'Person', 'active', 'verified', 1, 1, 'ADMIN')`,
    'public handle',
  )

  assert.ok(
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?")
      .get('identity_account_public_handle_idx'),
    'the handle index must exist',
  )

  console.log('public handle schema tests passed')
} finally {
  database.close()
}
