import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { migrationFiles } from './sqlite-fixture.mjs'
import { hash, opaque } from './unified-identity-schema-fixture.mjs'

const migrationsDirectory = new URL('../cloudflare/d1/', import.meta.url)
const database = new DatabaseSync(':memory:')
database.exec('PRAGMA foreign_keys = ON')

try {
  const files = await migrationFiles()
  for (const file of files.filter(file => file < '0020_')) {
    database.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }

  const principalId = `p_${opaque('P')}`
  const participantAccountId = opaque('A')
  const adminAccountId = opaque('B')
  database.exec(`
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'legacy-admin', 'salt', 'hash');
    INSERT INTO participant_principal (id, webauthn_user_handle)
    VALUES ('${principalId}', '${opaque('U')}');
    INSERT INTO participant_passkey_credential
      (credential_id, principal_id, public_key, device_type, created_at)
    VALUES ('legacy_credential', '${principalId}', 'cHVibGlj', 'multiDevice', 100);
    INSERT INTO admin_session (token_hash, admin_id, expires_at)
    VALUES ('${hash('1')}', 1, 1000);
    INSERT INTO participant_session
      (token_hash, principal_id, credential_id, created_at, expires_at)
    VALUES ('${hash('2')}', '${principalId}', 'legacy_credential', 100, 1000);
    INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
    VALUES
      ('${participantAccountId}', '${opaque('U')}', 'Migrated participant',
       'active', 'legacy_unverified', 100, 100),
      ('${adminAccountId}', '${opaque('V')}', 'Migrated owner',
       'active', 'verified', 100, 100);
    INSERT INTO identity_legacy_subject_map
      (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
       migration_version, mapped_at)
    VALUES
      ('participant_principal', '${principalId}', '${participantAccountId}', 0,
       '${hash('3')}', 1, 200),
      ('admin_account', '1', '${adminAccountId}', 0, '${hash('4')}', 1, 200);
  `)

  database.exec(
    await readFile(new URL('0020_legacy_cutover_session_guards.sql', migrationsDirectory), 'utf8'),
  )
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM admin_session').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count, 0)
  assert.throws(
    () =>
      database
        .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, 1000)')
        .run(hash('5')),
    /completed identity cutover/,
  )
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO participant_session
            (token_hash, principal_id, credential_id, created_at, expires_at)
           VALUES (?, ?, 'legacy_credential', 100, 1000)`,
        )
        .run(hash('6'), principalId),
    /completed identity cutover/,
  )
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('legacy cutover session guard schema tests passed')
} finally {
  database.close()
}
