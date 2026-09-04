import assert from 'node:assert/strict'

import {
  account,
  assertUnifiedIdentityPrivateSchema,
  createUnifiedIdentitySchemaFixture,
  hash,
  identity,
  identityKeyHash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError, insertAccount } = await createUnifiedIdentitySchemaFixture()

try {
  assert.ok(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'identity_notification_outbox_stale_lease_idx'",
      )
      .get(),
  )
  const staleLeasePlan = database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM identity_notification_outbox
       WHERE status = 'leased' AND leased_until <= ? AND expires_at > ?`,
    )
    .all(100, 50)
    .map(row => row.detail)
    .join(' ')
  assert.match(staleLeasePlan, /identity_notification_outbox_stale_lease_idx/)
  assert.ok(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'identity_security_event_created_idx'",
      )
      .get(),
  )
  const securityEventOrderPlan = database
    .prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM identity_security_event ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .all()
    .map(row => row.detail)
    .join(' ')
  assert.match(securityEventOrderPlan, /identity_security_event_created_idx/)
  execute(
    `INSERT INTO identity_security_event
      (id, event_type, actor_type, actor_account_id, target_account_id, actor_session_id,
       resource_type, resource_id, request_correlation_id, deduplication_key, created_at)
     VALUES (?, 'account.created', 'account', ?, ?, ?, 'account', ?,
             'request-correlation-1', ?, 200)`,
    [opaque('e'), account.alpha, account.alpha, opaque('S'), account.alpha, hash('b')],
  )
  expectError(
    () =>
      execute("UPDATE identity_security_event SET severity = 'high' WHERE id = ?", [opaque('e')]),
    /append-only/,
  )
  expectError(
    () => execute('DELETE FROM identity_security_event WHERE id = ?', [opaque('e')]),
    /retention/,
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_security_event
        (id, event_type, actor_type, resource_type, request_correlation_id, deduplication_key,
         retention_class, retention_until, created_at)
       VALUES (?, 'account.locked', 'system', 'platform', 'retention-finite-security', ?,
               'account_security', 604800100, 100)`,
      [opaque('f'), hash('e')],
    ),
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_security_event
        (id, event_type, actor_type, resource_type, request_correlation_id, deduplication_key,
         retention_class, retention_until, created_at)
       VALUES (?, 'anonymous.sampled', 'anonymous', 'platform', 'retention-too-short', ?,
               'anonymous_sampled', 604800099, 100)`,
      [opaque('g'), hash('f')],
    ),
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_security_event
        (id, event_type, actor_type, target_account_id, resource_type,
         request_correlation_id, deduplication_key, retention_class, retention_until, created_at)
       VALUES (?, 'account.locked', 'anonymous', ?, 'account', 'retention-relabeled-1', ?,
               'anonymous_sampled', unixepoch() * 1000 + 604800000, 100)`,
      [opaque('i'), account.alpha, hash('h')],
    ),
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_security_event
          (id, event_type, actor_type, resource_type, request_correlation_id,
           deduplication_key, retention_class, recorded_at, created_at)
         VALUES (?, 'account.locked', 'system', 'platform', 'retention-backdate-1', ?,
                 'account_security', 100, 100)`,
        [opaque('h'), hash('g')],
      ),
    /database-current/,
  )

  expectError(
    () =>
      execute(
        `INSERT INTO identity_notification_outbox
          (id, security_event_id, idempotency_key, channel, template_key,
           destination_identity_id, destination_key_hash, destination_hint, available_at,
           created_at, expires_at)
         VALUES (?, ?, ?, 'email', 'account.created', ?, ?, 's***@example.edu', 200, 200, 1000)`,
        [opaque('v'), opaque('e'), hash('a'), identity.alpha, hash('f')],
      ),
    /verified destination mismatch/,
  )

  execute(
    `INSERT INTO identity_notification_outbox
      (id, security_event_id, idempotency_key, channel, template_key, destination_identity_id,
       destination_key_hash, destination_hint, available_at, created_at, expires_at)
     VALUES (?, ?, ?, 'email', 'account.created', ?, ?, 's***@example.edu', 200, 200, 1000)`,
    [
      opaque('x'),
      opaque('e'),
      hash('c'),
      identity.alpha,
      identityKeyHash('campus', 'https://id.example/tenant-a', 'Student-1'),
    ],
  )
  execute(
    `UPDATE identity_notification_outbox
     SET status = 'leased', attempt_count = 1, lease_nonce = ?, leased_until = 300,
         revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('w'), opaque('y'), opaque('x')],
  )
  execute(
    `UPDATE identity_notification_outbox
     SET status = 'delivered', lease_nonce = NULL, leased_until = NULL, delivered_at = 300,
         provider_receipt = 'receipt-1', revision = 2, write_nonce = ? WHERE id = ?`,
    [opaque('z'), opaque('x')],
  )
  expectError(() =>
    execute('UPDATE identity_notification_outbox SET revision = 3, write_nonce = ? WHERE id = ?', [
      opaque('0'),
      opaque('x'),
    ]),
  )

  execute(
    `INSERT INTO identity_legacy_subject_map
      (subject_type, subject_id, account_id, source_snapshot_hash, migration_version, mapped_at)
     VALUES ('participant_principal', ?, ?, ?, 1, 100)`,
    [`p_${opaque('j')}`, account.alpha, hash('e')],
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_legacy_subject_map
        (subject_type, subject_id, account_id, source_snapshot_hash, migration_version, mapped_at)
       VALUES ('admin_account', '1', ?, ?, 1, 100)`,
      [account.alpha, hash('f')],
    ),
  )
  expectError(() =>
    execute(
      `UPDATE identity_legacy_subject_map
       SET source_revision = 1, migration_version = 2, revision = 1, write_nonce = ?
       WHERE subject_type = 'participant_principal' AND subject_id = ?`,
      [opaque('1'), `p_${opaque('j')}`],
    ),
  )
  execute(
    `UPDATE identity_legacy_subject_map
     SET source_revision = 1, source_snapshot_hash = ?, migration_version = 2,
         revision = 1, write_nonce = ?
     WHERE subject_type = 'participant_principal' AND subject_id = ?`,
    [hash('d'), opaque('1'), `p_${opaque('j')}`],
  )
  expectError(
    () =>
      execute(
        `DELETE FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ?`,
        [`p_${opaque('j')}`],
      ),
    /retained/,
  )

  execute(
    `INSERT INTO identity_cutover
      (account_id, phase, cohort_key, migration_version, created_at, updated_at)
     VALUES (?, 0, 'canary', 1, 100, 100)`,
    [account.alpha],
  )
  execute(
    `UPDATE identity_cutover
     SET phase = 1, ready_at = 200, updated_at = 200, revision = 1, write_nonce = ?
     WHERE account_id = ?`,
    [opaque('2'), account.alpha],
  )
  expectError(() =>
    execute(
      `UPDATE identity_cutover
       SET phase = 0, ready_at = NULL, updated_at = 300, revision = 2, write_nonce = ?
       WHERE account_id = ?`,
      [opaque('3'), account.alpha],
    ),
  )
  expectError(
    () => execute('DELETE FROM identity_cutover WHERE account_id = ?', [account.alpha]),
    /monotonic/,
  )

  const mergeSourceAccount = opaque('m')
  const mergeTargetAccount = opaque('n')
  insertAccount(mergeSourceAccount, opaque('4'), 'Merge Source')
  insertAccount(mergeTargetAccount, opaque('5'), 'Merge Target')
  expectError(
    () =>
      execute(
        `UPDATE identity_account
         SET status = 'merged', merged_into_id = ?, security_version = 1, updated_at = 200,
             revision = 1, write_nonce = ? WHERE id = ?`,
        [opaque('o'), opaque('6'), mergeSourceAccount],
      ),
    /merge target must be active/,
  )
  execute(
    `UPDATE identity_account
     SET status = 'merged', merged_into_id = ?, security_version = 1, updated_at = 200,
         revision = 1, write_nonce = ? WHERE id = ?`,
    [mergeTargetAccount, opaque('6'), mergeSourceAccount],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_account
         SET status = 'merged', merged_into_id = ?, security_version = 1, updated_at = 200,
             revision = 1, write_nonce = ? WHERE id = ?`,
        [mergeSourceAccount, opaque('7'), mergeTargetAccount],
      ),
    /merge target must be active/,
  )

  assertUnifiedIdentityPrivateSchema(database)
  console.log('unified identity operations schema tests passed')
} finally {
  database.close()
}
