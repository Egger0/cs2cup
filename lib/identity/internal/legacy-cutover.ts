import 'server-only'

import type { IdentityDatabase } from './contracts.ts'

export function legacyCutoverStatements(
  database: IdentityDatabase,
  input: {
    subjectType: 'participant_principal' | 'admin_account'
    subjectId: string
    accountId: string
    sourceRevision: number
    sourceSnapshotHash: string
    cohortKey: 'legacy_participant' | 'legacy_admin'
    now: number
  },
) {
  return [
    database
      .prepare(
        `INSERT INTO identity_legacy_subject_map
          (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
           migration_version, mapped_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(
        input.subjectType,
        input.subjectId,
        input.accountId,
        input.sourceRevision,
        input.sourceSnapshotHash,
        input.now,
      ),
    database
      .prepare(
        `INSERT INTO identity_cutover
          (account_id, phase, cohort_key, migration_version, ready_at, active_at,
           target_only_at, created_at, updated_at)
         VALUES (?, 3, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.accountId,
        input.cohortKey,
        input.now,
        input.now,
        input.now,
        input.now,
        input.now,
      ),
  ]
}
