CREATE TABLE IF NOT EXISTS admin_login_attempt (
  bucket_start INTEGER NOT NULL
    CHECK (typeof(bucket_start) = 'integer' AND bucket_start >= 0),
  fingerprint TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(fingerprint) = 67
      AND substr(fingerprint, 1, 3) = 'v1:'
      AND substr(fingerprint, 4) NOT GLOB '*[^0-9a-f]*'
    ),
  attempt_count INTEGER NOT NULL DEFAULT 1
    CHECK (
      typeof(attempt_count) = 'integer'
      AND attempt_count BETWEEN 1 AND 5
    ),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at = bucket_start + 600000
    ),
  PRIMARY KEY (bucket_start, fingerprint)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS admin_login_attempt_expiry_idx
ON admin_login_attempt(expires_at);

CREATE TRIGGER IF NOT EXISTS admin_login_attempt_capacity_before_insert
BEFORE INSERT ON admin_login_attempt
WHEN NOT EXISTS (
    SELECT 1
    FROM admin_login_attempt
    WHERE bucket_start = NEW.bucket_start
      AND fingerprint = NEW.fingerprint
  )
  AND (
    SELECT COUNT(*)
    FROM admin_login_attempt
    WHERE bucket_start = NEW.bucket_start
  ) >= 2048
BEGIN
  SELECT RAISE(ABORT, 'admin login attempt capacity exceeded');
END;

CREATE TRIGGER IF NOT EXISTS admin_login_attempt_increment_before_update
BEFORE UPDATE ON admin_login_attempt
WHEN NEW.bucket_start IS NOT OLD.bucket_start
  OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.attempt_count != OLD.attempt_count + 1
BEGIN
  SELECT RAISE(ABORT, 'admin login attempt state conflict');
END;
