CREATE TABLE identity_assisted_recovery_case_backup AS
SELECT * FROM identity_assisted_recovery_case;

DROP TABLE identity_assisted_recovery_case;

CREATE TABLE identity_assisted_recovery_case (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  receipt_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  evidence_statement TEXT NOT NULL
    CHECK (
      length(evidence_statement) BETWEEN 10 AND 2000
      AND evidence_statement = trim(evidence_statement)
    ),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  requested_at INTEGER NOT NULL
    CHECK (typeof(requested_at) = 'integer' AND requested_at >= 0),
  not_before_at INTEGER NOT NULL
    CHECK (
      typeof(not_before_at) = 'integer'
      AND not_before_at >= requested_at
    ),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > not_before_at
      AND expires_at <= requested_at + 2592000000
    ),
  review_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_assisted_recovery_review(id) ON DELETE RESTRICT,
  reviewed_at INTEGER
    CHECK (
      reviewed_at IS NULL
      OR (typeof(reviewed_at) = 'integer' AND reviewed_at BETWEEN requested_at AND expires_at)
    ),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at BETWEEN not_before_at AND expires_at - 1)
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  UNIQUE (id, receipt_hash),
  CHECK (
    (status = 'pending' AND review_id IS NULL AND reviewed_at IS NULL AND consumed_at IS NULL)
    OR
    (status IN ('approved', 'rejected')
      AND review_id IS NOT NULL AND reviewed_at IS NOT NULL AND consumed_at IS NULL)
    OR
    (status = 'consumed'
      AND review_id IS NOT NULL AND reviewed_at IS NOT NULL AND consumed_at IS NOT NULL)
    OR
    (status = 'expired' AND consumed_at IS NULL)
  )
);

INSERT INTO identity_assisted_recovery_case
SELECT * FROM identity_assisted_recovery_case_backup;

DROP TABLE identity_assisted_recovery_case_backup;

CREATE INDEX identity_assisted_recovery_case_queue_idx
ON identity_assisted_recovery_case(status, requested_at);

CREATE INDEX identity_assisted_recovery_case_expiry_idx
ON identity_assisted_recovery_case(expires_at)
WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX identity_assisted_recovery_case_write_nonce_idx
ON identity_assisted_recovery_case(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER identity_assisted_recovery_case_fresh_insert_guard
BEFORE INSERT ON identity_assisted_recovery_case
WHEN NEW.status != 'pending'
  OR NEW.review_id IS NOT NULL
  OR NEW.reviewed_at IS NOT NULL
  OR NEW.consumed_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account AS account
    JOIN identity_password_credential AS credential ON credential.account_id = account.id
    WHERE account.id = NEW.account_id
      AND account.status = 'active'
      AND credential.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case requires an active password account');
END;

CREATE TRIGGER identity_assisted_recovery_case_update_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.receipt_hash IS NOT OLD.receipt_hash
  OR NEW.evidence_statement IS NOT OLD.evidence_statement
  OR NEW.requested_at IS NOT OLD.requested_at
  OR NEW.not_before_at IS NOT OLD.not_before_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status IN ('rejected', 'consumed', 'expired')
  OR NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'expired'))
    OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'expired'))
  )
  OR (OLD.review_id IS NOT NULL AND NEW.review_id IS NOT OLD.review_id)
  OR (OLD.reviewed_at IS NOT NULL AND NEW.reviewed_at IS NOT OLD.reviewed_at)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case state conflict');
END;

CREATE TRIGGER identity_assisted_recovery_case_review_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN OLD.status = 'pending'
  AND NEW.status IN ('approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM identity_assisted_recovery_review AS review
    WHERE review.id = NEW.review_id
      AND review.case_id = OLD.id
      AND review.decision = NEW.status
      AND review.decided_at = NEW.reviewed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery decision proof mismatch');
END;

CREATE TRIGGER identity_assisted_recovery_case_consumption_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN OLD.status = 'approved' AND NEW.status = 'consumed'
  AND NOT EXISTS (
    SELECT 1 FROM identity_assisted_recovery_authorization AS authorization
    WHERE authorization.case_id = OLD.id
      AND authorization.consumed_at = NEW.consumed_at
      AND authorization.consumed_at >= OLD.not_before_at
      AND authorization.consumed_at < OLD.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery consumption proof mismatch');
END;

CREATE TRIGGER identity_assisted_recovery_case_expiry_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN NEW.status = 'expired'
  AND NOT (
    NEW.expires_at <= unixepoch() * 1000
    OR (OLD.status = 'approved' AND EXISTS (
      SELECT 1 FROM identity_assisted_recovery_authorization AS authorization
      WHERE authorization.case_id = OLD.id
        AND authorization.consumed_at IS NULL
        AND authorization.expires_at <= unixepoch() * 1000
    ))
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case has not expired');
END;

CREATE TRIGGER identity_assisted_recovery_case_delete_guard
BEFORE DELETE ON identity_assisted_recovery_case
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery cases are retained');
END;

CREATE TRIGGER identity_assisted_recovery_case_insert_conflict_guard
BEFORE INSERT ON identity_assisted_recovery_case
WHEN EXISTS (
  SELECT 1 FROM identity_assisted_recovery_case AS existing
  WHERE existing.id = NEW.id
    OR existing.receipt_hash = NEW.receipt_hash
    OR (NEW.review_id IS NOT NULL AND existing.review_id = NEW.review_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case insert conflict');
END;
