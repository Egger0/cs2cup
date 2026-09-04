ALTER TABLE identity_membership_review
ADD COLUMN reason_category TEXT NOT NULL DEFAULT 'other'
  CHECK (
    reason_category IN (
      'eligible',
      'insufficient_evidence',
      'not_eligible',
      'duplicate',
      'other'
    )
  );

DROP TRIGGER identity_membership_fresh_insert_guard;
DROP TRIGGER identity_membership_update_guard;
DROP TRIGGER identity_membership_delete_guard;
DROP TRIGGER identity_membership_insert_conflict_guard;
DROP TRIGGER identity_membership_application_fresh_insert_guard;
DROP INDEX identity_membership_status_idx;
DROP INDEX identity_membership_write_nonce_idx;

CREATE TABLE identity_membership_next (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_membership_application(id) ON DELETE RESTRICT,
  approved_review_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_membership_review(id) ON DELETE RESTRICT,
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'approved'
    CHECK (status IN ('approved', 'suspended', 'revoked')),
  approved_at INTEGER NOT NULL
    CHECK (typeof(approved_at) = 'integer' AND approved_at >= 0),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoker_session_id TEXT COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 3 AND 1000 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= approved_at)),
  status_changed_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  status_changed_session_id TEXT COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  status_change_reason TEXT
    CHECK (
      status_change_reason IS NULL
      OR (length(status_change_reason) BETWEEN 3 AND 1000
        AND status_change_reason = trim(status_change_reason))
    ),
  status_changed_at INTEGER
    CHECK (
      status_changed_at IS NULL
      OR (typeof(status_changed_at) = 'integer' AND status_changed_at >= approved_at)
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (status_changed_by_account_id IS NULL AND status_changed_session_id IS NULL
      AND status_change_reason IS NULL AND status_changed_at IS NULL)
    OR
    (status_changed_by_account_id IS NOT NULL AND status_changed_session_id IS NOT NULL
      AND status_change_reason IS NOT NULL AND status_changed_at IS NOT NULL)
  ),
  CHECK (
    (status = 'revoked' AND revoked_by_account_id IS status_changed_by_account_id
      AND revoker_session_id IS status_changed_session_id
      AND revoke_reason IS status_change_reason AND revoked_at IS status_changed_at)
    OR
    (status IN ('approved', 'suspended') AND revoked_by_account_id IS NULL
      AND revoker_session_id IS NULL AND revoke_reason IS NULL AND revoked_at IS NULL)
  ),
  CHECK (status != 'suspended' OR status_changed_at IS NOT NULL)
);

INSERT INTO identity_membership_next
  (id, account_id, application_id, approved_review_id, status, approved_at,
   revoked_by_account_id, revoker_session_id, revoke_reason, revoked_at,
   status_changed_by_account_id, status_changed_session_id, status_change_reason,
   status_changed_at, revision, write_nonce)
SELECT id, account_id, application_id, approved_review_id, status, approved_at,
       revoked_by_account_id, revoker_session_id, revoke_reason, revoked_at,
       revoked_by_account_id, revoker_session_id, revoke_reason, revoked_at, revision, write_nonce
FROM identity_membership;

DROP TABLE identity_membership;
ALTER TABLE identity_membership_next RENAME TO identity_membership;

CREATE TRIGGER identity_membership_application_fresh_insert_guard
BEFORE INSERT ON identity_membership_application
WHEN NEW.status != 'draft'
  OR NEW.submission_version != 0
  OR NEW.submission_digest IS NOT NULL
  OR NEW.submitted_at IS NOT NULL
  OR NEW.latest_review_id IS NOT NULL
  OR NEW.latest_reviewed_at IS NOT NULL
  OR NEW.assigned_reviewer_account_id IS NOT NULL
  OR NEW.assigned_reviewer_session_id IS NOT NULL
  OR NEW.review_started_at IS NOT NULL
  OR NEW.last_applicant_update_at != NEW.created_at
  OR NEW.updated_at != NEW.created_at
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account AS account
    JOIN identity_session AS applicant_session
      ON applicant_session.id = NEW.last_applicant_session_id
     AND applicant_session.account_id = account.id
    WHERE account.id = NEW.account_id
      AND account.status = 'active'
      AND account.security_version = applicant_session.security_version
      AND applicant_session.revoked_at IS NULL
      AND applicant_session.recovery_restricted = 0
      AND applicant_session.created_at <= NEW.created_at
      AND applicant_session.idle_expires_at > NEW.created_at
      AND applicant_session.absolute_expires_at > NEW.created_at
  )
  OR EXISTS (
    SELECT 1 FROM identity_membership
    WHERE account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'membership application must start as an account draft');
END;

CREATE INDEX identity_membership_status_idx
ON identity_membership(status, account_id);

CREATE UNIQUE INDEX identity_membership_write_nonce_idx
ON identity_membership(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TABLE identity_membership_status_event (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  membership_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_membership(id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL COLLATE BINARY
    CHECK (from_status IN ('approved', 'suspended')),
  to_status TEXT NOT NULL COLLATE BINARY
    CHECK (to_status IN ('approved', 'suspended', 'revoked')),
  actor_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  actor_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL
    CHECK (length(reason) BETWEEN 3 AND 1000 AND reason = trim(reason)),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  request_correlation_id TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    ),
  CHECK (
    (from_status = 'approved' AND to_status IN ('suspended', 'revoked'))
    OR (from_status = 'suspended' AND to_status IN ('approved', 'revoked'))
  )
);

CREATE INDEX identity_membership_status_event_membership_idx
ON identity_membership_status_event(membership_id, created_at DESC);

CREATE TRIGGER identity_membership_status_event_insert_guard
BEFORE INSERT ON identity_membership_status_event
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_membership AS membership
  JOIN identity_account AS reviewer ON reviewer.id = NEW.actor_account_id
  JOIN identity_session AS reviewer_session
    ON reviewer_session.id = NEW.actor_session_id
   AND reviewer_session.account_id = reviewer.id
  JOIN identity_role_assignment AS assignment ON assignment.account_id = reviewer.id
  WHERE membership.id = NEW.membership_id
    AND membership.status = NEW.from_status
    AND reviewer.status = 'active'
    AND reviewer.security_version = reviewer_session.security_version
    AND reviewer_session.revoked_at IS NULL
    AND reviewer_session.recovery_restricted = 0
    AND reviewer_session.authenticated_at >= NEW.created_at - 900000
    AND reviewer_session.authenticated_at <= NEW.created_at
    AND reviewer_session.created_at <= NEW.created_at
    AND reviewer_session.idle_expires_at > NEW.created_at
    AND reviewer_session.absolute_expires_at > NEW.created_at
    AND assignment.scope_type = 'platform'
    AND assignment.role IN ('identity_reviewer', 'platform_owner')
    AND assignment.revoked_at IS NULL
    AND assignment.granted_at <= NEW.created_at
    AND (assignment.expires_at IS NULL OR assignment.expires_at > NEW.created_at)
)
BEGIN
  SELECT RAISE(ABORT, 'membership status event requires a current identity reviewer');
END;

CREATE TRIGGER identity_membership_status_event_update_guard
BEFORE UPDATE ON identity_membership_status_event
BEGIN
  SELECT RAISE(ABORT, 'membership status events are append-only');
END;

CREATE TRIGGER identity_membership_status_event_delete_guard
BEFORE DELETE ON identity_membership_status_event
BEGIN
  SELECT RAISE(ABORT, 'membership status events are retained');
END;

CREATE TRIGGER identity_membership_fresh_insert_guard
BEFORE INSERT ON identity_membership
WHEN NEW.status != 'approved'
  OR NEW.revoked_by_account_id IS NOT NULL
  OR NEW.revoker_session_id IS NOT NULL
  OR NEW.revoke_reason IS NOT NULL
  OR NEW.revoked_at IS NOT NULL
  OR NEW.status_changed_by_account_id IS NOT NULL
  OR NEW.status_changed_session_id IS NOT NULL
  OR NEW.status_change_reason IS NOT NULL
  OR NEW.status_changed_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_membership_application AS application
    JOIN identity_membership_review AS review ON review.id = NEW.approved_review_id
    JOIN identity_account AS account ON account.id = application.account_id
    WHERE application.id = NEW.application_id
      AND application.account_id = NEW.account_id
      AND application.status = 'approved'
      AND application.latest_review_id = review.id
      AND review.application_id = application.id
      AND review.submission_version = application.submission_version
      AND review.submission_digest = application.submission_digest
      AND review.decision = 'approved'
      AND review.decided_at = NEW.approved_at
      AND account.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'membership requires an approved application revision');
END;

CREATE TRIGGER identity_membership_update_guard
BEFORE UPDATE ON identity_membership
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.application_id IS NOT OLD.application_id
  OR NEW.approved_review_id IS NOT OLD.approved_review_id
  OR NEW.approved_at IS NOT OLD.approved_at
  OR OLD.status = 'revoked'
  OR NOT (
    (OLD.status = 'approved' AND NEW.status IN ('suspended', 'revoked'))
    OR (OLD.status = 'suspended' AND NEW.status IN ('approved', 'revoked'))
  )
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.status_changed_by_account_id IS NULL
  OR NEW.status_changed_session_id IS NULL
  OR NEW.status_change_reason IS NULL
  OR NEW.status_changed_at IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM identity_membership_status_event AS event
    WHERE event.membership_id = OLD.id
      AND event.from_status = OLD.status
      AND event.to_status = NEW.status
      AND event.actor_account_id = NEW.status_changed_by_account_id
      AND event.actor_session_id = NEW.status_changed_session_id
      AND event.reason = NEW.status_change_reason
      AND event.created_at = NEW.status_changed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'membership status transition requires an audited reviewer action');
END;

CREATE TRIGGER identity_membership_delete_guard
BEFORE DELETE ON identity_membership
BEGIN
  SELECT RAISE(ABORT, 'memberships are retained');
END;

CREATE TRIGGER identity_membership_insert_conflict_guard
BEFORE INSERT ON identity_membership
WHEN EXISTS (
  SELECT 1 FROM identity_membership AS existing
  WHERE existing.id = NEW.id
    OR existing.account_id = NEW.account_id
    OR existing.application_id = NEW.application_id
    OR existing.approved_review_id = NEW.approved_review_id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'membership insert conflict');
END;

CREATE TABLE identity_membership_review_transfer (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  application_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_membership_application(id) ON DELETE RESTRICT,
  from_reviewer_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  from_reviewer_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  to_reviewer_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL
    CHECK (length(reason) BETWEEN 3 AND 500 AND reason = trim(reason)),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  request_correlation_id TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    ),
  CHECK (from_reviewer_account_id != to_reviewer_account_id)
);

CREATE INDEX identity_membership_review_transfer_target_idx
ON identity_membership_review_transfer(to_reviewer_account_id, created_at DESC);

CREATE INDEX identity_membership_review_transfer_application_idx
ON identity_membership_review_transfer(application_id, created_at DESC);

CREATE TRIGGER identity_membership_review_transfer_insert_guard
BEFORE INSERT ON identity_membership_review_transfer
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_membership_application AS application
  JOIN identity_account AS reviewer ON reviewer.id = NEW.from_reviewer_account_id
  JOIN identity_session AS reviewer_session
    ON reviewer_session.id = NEW.from_reviewer_session_id
   AND reviewer_session.account_id = reviewer.id
  JOIN identity_role_assignment AS reviewer_role
    ON reviewer_role.account_id = reviewer.id
  JOIN identity_account AS target ON target.id = NEW.to_reviewer_account_id
  JOIN identity_role_assignment AS target_role
    ON target_role.account_id = target.id
  WHERE application.id = NEW.application_id
    AND application.status = 'in_review'
    AND application.assigned_reviewer_account_id = reviewer.id
    AND application.account_id != target.id
    AND reviewer.status = 'active'
    AND reviewer.security_version = reviewer_session.security_version
    AND reviewer_session.revoked_at IS NULL
    AND reviewer_session.recovery_restricted = 0
    AND reviewer_session.authenticated_at >= NEW.created_at - 900000
    AND reviewer_session.authenticated_at <= NEW.created_at
    AND reviewer_session.created_at <= NEW.created_at
    AND reviewer_session.idle_expires_at > NEW.created_at
    AND reviewer_session.absolute_expires_at > NEW.created_at
    AND reviewer_role.scope_type = 'platform'
    AND reviewer_role.role IN ('identity_reviewer', 'platform_owner')
    AND reviewer_role.revoked_at IS NULL
    AND reviewer_role.granted_at <= NEW.created_at
    AND (reviewer_role.expires_at IS NULL OR reviewer_role.expires_at > NEW.created_at)
    AND target.status = 'active'
    AND target_role.scope_type = 'platform'
    AND target_role.role IN ('identity_reviewer', 'platform_owner')
    AND target_role.revoked_at IS NULL
    AND target_role.granted_at <= NEW.created_at
    AND (target_role.expires_at IS NULL OR target_role.expires_at > NEW.created_at)
)
OR EXISTS (
  SELECT 1
  FROM identity_membership_review_transfer AS existing
  JOIN identity_membership_application AS application
    ON application.id = existing.application_id
  WHERE existing.application_id = NEW.application_id
    AND existing.to_reviewer_account_id = NEW.to_reviewer_account_id
    AND existing.from_reviewer_account_id = NEW.from_reviewer_account_id
    AND existing.created_at >= application.review_started_at
)
BEGIN
  SELECT RAISE(ABORT, 'membership review transfer requires current reviewers');
END;

CREATE TRIGGER identity_membership_review_transfer_update_guard
BEFORE UPDATE ON identity_membership_review_transfer
BEGIN
  SELECT RAISE(ABORT, 'membership review transfers are append-only');
END;

CREATE TRIGGER identity_membership_review_transfer_delete_guard
BEFORE DELETE ON identity_membership_review_transfer
BEGIN
  SELECT RAISE(ABORT, 'membership review transfers are retained');
END;

DROP TRIGGER identity_membership_application_update_guard;

CREATE TRIGGER identity_membership_application_update_guard
BEFORE UPDATE ON identity_membership_application
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status IN ('approved', 'rejected', 'withdrawn')
  OR NOT (
    (OLD.status = 'draft' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'draft' AND NEW.status = 'pending'
      AND NEW.submission_version = OLD.submission_version + 1
      AND NEW.submitted_at = NEW.updated_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'pending' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'pending' AND NEW.status = 'in_review'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.identity_claim IS OLD.identity_claim
      AND NEW.contact IS OLD.contact
      AND NEW.application_reason IS OLD.application_reason
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = OLD.last_applicant_update_at
      AND NEW.last_applicant_session_id IS OLD.last_applicant_session_id
      AND NEW.review_started_at = NEW.updated_at)
    OR
    (OLD.status = 'in_review' AND NEW.status = 'in_review'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.identity_claim IS OLD.identity_claim
      AND NEW.contact IS OLD.contact
      AND NEW.application_reason IS OLD.application_reason
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.assigned_reviewer_account_id IS NOT OLD.assigned_reviewer_account_id
      AND NEW.assigned_reviewer_session_id IS NOT OLD.assigned_reviewer_session_id
      AND NEW.review_started_at = NEW.updated_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = OLD.last_applicant_update_at
      AND NEW.last_applicant_session_id IS OLD.last_applicant_session_id)
    OR
    (OLD.status = 'in_review'
      AND NEW.status IN ('changes_requested', 'approved', 'rejected')
      AND NEW.submission_version = OLD.submission_version
      AND NEW.identity_claim IS OLD.identity_claim
      AND NEW.contact IS OLD.contact
      AND NEW.application_reason IS OLD.application_reason
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.assigned_reviewer_account_id IS OLD.assigned_reviewer_account_id
      AND NEW.assigned_reviewer_session_id IS OLD.assigned_reviewer_session_id
      AND NEW.review_started_at IS OLD.review_started_at
      AND NEW.last_applicant_update_at = OLD.last_applicant_update_at
      AND NEW.last_applicant_session_id IS OLD.last_applicant_session_id
      AND NEW.latest_reviewed_at = NEW.updated_at)
    OR
    (OLD.status = 'changes_requested' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'changes_requested' AND NEW.status = 'pending'
      AND NEW.submission_version = OLD.submission_version + 1
      AND NEW.submitted_at = NEW.updated_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status IN ('draft', 'pending', 'in_review', 'changes_requested')
      AND NEW.status = 'withdrawn'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.assigned_reviewer_account_id IS OLD.assigned_reviewer_account_id
      AND NEW.assigned_reviewer_session_id IS OLD.assigned_reviewer_session_id
      AND NEW.review_started_at IS OLD.review_started_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'membership application state conflict');
END;

CREATE TRIGGER identity_membership_application_transfer_authority_guard
BEFORE UPDATE ON identity_membership_application
WHEN OLD.status = 'in_review'
  AND NEW.status = 'in_review'
  AND NEW.assigned_reviewer_account_id IS NOT OLD.assigned_reviewer_account_id
  AND NOT EXISTS (
    SELECT 1
    FROM identity_membership_review_transfer AS transfer
    JOIN identity_account AS target ON target.id = NEW.assigned_reviewer_account_id
    JOIN identity_session AS target_session
      ON target_session.id = NEW.assigned_reviewer_session_id
     AND target_session.account_id = target.id
    JOIN identity_role_assignment AS target_role ON target_role.account_id = target.id
    WHERE transfer.application_id = OLD.id
      AND transfer.from_reviewer_account_id = OLD.assigned_reviewer_account_id
      AND transfer.to_reviewer_account_id = target.id
      AND transfer.created_at >= OLD.review_started_at
      AND transfer.created_at <= NEW.review_started_at
      AND target.id != OLD.account_id
      AND target.status = 'active'
      AND target.security_version = target_session.security_version
      AND target_session.revoked_at IS NULL
      AND target_session.recovery_restricted = 0
      AND target_session.authenticated_at >= NEW.review_started_at - 900000
      AND target_session.authenticated_at <= NEW.review_started_at
      AND target_session.created_at <= NEW.review_started_at
      AND target_session.idle_expires_at > NEW.review_started_at
      AND target_session.absolute_expires_at > NEW.review_started_at
      AND target_role.scope_type = 'platform'
      AND target_role.role IN ('identity_reviewer', 'platform_owner')
      AND target_role.revoked_at IS NULL
      AND target_role.granted_at <= NEW.review_started_at
      AND (target_role.expires_at IS NULL OR target_role.expires_at > NEW.review_started_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'membership review transfer acceptance requires the target reviewer');
END;
