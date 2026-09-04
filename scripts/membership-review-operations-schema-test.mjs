import assert from 'node:assert/strict'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const database = await createMigratedDatabase()

try {
  const reviewColumns = new Map(
    database
      .prepare('PRAGMA table_info(identity_membership_review)')
      .all()
      .map(row => [row.name, row]),
  )
  assert.equal(reviewColumns.get('reason_category')?.notnull, 1)
  assert.equal(reviewColumns.get('reason_category')?.dflt_value, "'other'")

  const membershipSchema = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'identity_membership'")
    .get().sql
  assert.match(membershipSchema, /'approved', 'suspended', 'revoked'/)
  for (const column of [
    'status_changed_by_account_id',
    'status_changed_session_id',
    'status_change_reason',
    'status_changed_at',
  ]) {
    assert.match(membershipSchema, new RegExp(`\\b${column}\\b`))
  }

  for (const [type, name] of [
    ['table', 'identity_membership_status_event'],
    ['table', 'identity_membership_review_transfer'],
    ['trigger', 'identity_membership_status_event_update_guard'],
    ['trigger', 'identity_membership_status_event_delete_guard'],
    ['trigger', 'identity_membership_review_transfer_update_guard'],
    ['trigger', 'identity_membership_review_transfer_delete_guard'],
    ['trigger', 'identity_membership_application_transfer_authority_guard'],
  ]) {
    assert.ok(
      database.prepare('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?').get(type, name),
      `${name} must be installed`,
    )
  }
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])

  console.log('membership review operations schema tests passed')
} finally {
  database.close()
}
