CREATE TABLE IF NOT EXISTS participant_passkey_credential (
  credential_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(credential_id) BETWEEN 1 AND 1366
      AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(public_key) BETWEEN 1 AND 8192
      AND public_key NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  counter INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(counter) = 'integer' AND counter >= 0),
  transports_json TEXT NOT NULL DEFAULT '[]'
    CHECK (
      length(transports_json) <= 512
      AND CASE
        WHEN json_valid(transports_json) THEN json_type(transports_json) = 'array'
        ELSE 0
      END
    ),
  device_type TEXT NOT NULL COLLATE BINARY
    CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up INTEGER NOT NULL DEFAULT 0
    CHECK (backed_up IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (
        length(write_nonce) = 43
        AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  last_used_at INTEGER
    CHECK (
      last_used_at IS NULL
      OR (typeof(last_used_at) = 'integer' AND last_used_at >= created_at)
    ),
  UNIQUE (credential_id, principal_id)
);

CREATE INDEX IF NOT EXISTS participant_passkey_credential_principal_idx
ON participant_passkey_credential(principal_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS participant_passkey_credential_write_nonce_idx
ON participant_passkey_credential(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS participant_passkey_credential_guard_before_update
BEFORE UPDATE ON participant_passkey_credential
WHEN NEW.credential_id IS NOT OLD.credential_id
  OR NEW.principal_id IS NOT OLD.principal_id
  OR NEW.public_key IS NOT OLD.public_key
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.counter < OLD.counter
  OR (
    OLD.last_used_at IS NOT NULL
    AND (
      NEW.last_used_at IS NULL
      OR NEW.last_used_at < OLD.last_used_at
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'passkey credential revision conflict');
END;

CREATE TABLE IF NOT EXISTS participant_webauthn_challenge (
  ceremony_token_hash TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(ceremony_token_hash) = 64
      AND ceremony_token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  challenge TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(challenge) = 43
      AND challenge NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  kind TEXT NOT NULL COLLATE BINARY
    CHECK (kind IN ('claim', 'authentication')),
  candidate_principal_id TEXT COLLATE BINARY
    CHECK (
      candidate_principal_id IS NULL
      OR (
        length(candidate_principal_id) = 45
        AND substr(candidate_principal_id, 1, 2) = 'p_'
        AND substr(candidate_principal_id, 3) NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  candidate_user_handle TEXT COLLATE BINARY
    CHECK (
      candidate_user_handle IS NULL
      OR (
        length(candidate_user_handle) = 43
        AND candidate_user_handle NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  candidate_team_id INTEGER
    REFERENCES team(id) ON DELETE CASCADE,
  candidate_management_token_hash TEXT COLLATE BINARY
    CHECK (
      candidate_management_token_hash IS NULL
      OR (
        length(candidate_management_token_hash) = 64
        AND candidate_management_token_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (
        length(consume_nonce) = 43
        AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 600000
    ),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (
        typeof(consumed_at) = 'integer'
        AND consumed_at >= created_at
        AND consumed_at < expires_at
      )
    ),
  CHECK (
    (kind = 'claim'
      AND candidate_principal_id IS NOT NULL
      AND candidate_user_handle IS NOT NULL
      AND candidate_team_id IS NOT NULL
      AND candidate_management_token_hash IS NOT NULL)
    OR
    (kind = 'authentication'
      AND candidate_principal_id IS NULL
      AND candidate_user_handle IS NULL
      AND candidate_team_id IS NULL
      AND candidate_management_token_hash IS NULL)
  ),
  CHECK (
    (consumed_at IS NULL AND consume_nonce IS NULL)
    OR
    (consumed_at IS NOT NULL AND consume_nonce IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS participant_webauthn_challenge_fresh_idx
ON participant_webauthn_challenge(kind, expires_at)
WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS participant_webauthn_challenge_expiry_idx
ON participant_webauthn_challenge(expires_at);

CREATE INDEX IF NOT EXISTS participant_webauthn_challenge_team_idx
ON participant_webauthn_challenge(candidate_team_id, expires_at)
WHERE candidate_team_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS participant_webauthn_challenge_fresh_before_insert
BEFORE INSERT ON participant_webauthn_challenge
WHEN NEW.consumed_at IS NOT NULL OR NEW.consume_nonce IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'passkey challenge must start fresh');
END;

CREATE TRIGGER IF NOT EXISTS participant_webauthn_challenge_consume_before_update
BEFORE UPDATE ON participant_webauthn_challenge
WHEN OLD.consumed_at IS NOT NULL
  OR OLD.consume_nonce IS NOT NULL
  OR NEW.ceremony_token_hash IS NOT OLD.ceremony_token_hash
  OR NEW.challenge IS NOT OLD.challenge
  OR NEW.kind IS NOT OLD.kind
  OR NEW.candidate_principal_id IS NOT OLD.candidate_principal_id
  OR NEW.candidate_user_handle IS NOT OLD.candidate_user_handle
  OR NEW.candidate_team_id IS NOT OLD.candidate_team_id
  OR NEW.candidate_management_token_hash IS NOT OLD.candidate_management_token_hash
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.consumed_at IS NULL
  OR NEW.consume_nonce IS NULL
BEGIN
  SELECT RAISE(ABORT, 'passkey challenge already consumed or immutable');
END;

CREATE TABLE IF NOT EXISTS participant_passkey_attempt (
  bucket_start INTEGER NOT NULL
    CHECK (typeof(bucket_start) = 'integer' AND bucket_start >= 0),
  kind TEXT NOT NULL COLLATE BINARY
    CHECK (kind IN ('claim', 'authentication')),
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
      AND expires_at > bucket_start
      AND expires_at <= bucket_start + 3600000
    ),
  PRIMARY KEY (bucket_start, kind, fingerprint)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS participant_passkey_attempt_expiry_idx
ON participant_passkey_attempt(expires_at);

CREATE TRIGGER IF NOT EXISTS participant_passkey_attempt_capacity_before_insert
BEFORE INSERT ON participant_passkey_attempt
WHEN NOT EXISTS (
    SELECT 1
    FROM participant_passkey_attempt
    WHERE bucket_start = NEW.bucket_start
      AND kind = NEW.kind
      AND fingerprint = NEW.fingerprint
  )
  AND (
    SELECT COUNT(*)
    FROM participant_passkey_attempt
    WHERE bucket_start = NEW.bucket_start
  ) >= 2048
BEGIN
  SELECT RAISE(ABORT, 'passkey options capacity exceeded');
END;

CREATE TRIGGER IF NOT EXISTS participant_passkey_attempt_increment_before_update
BEFORE UPDATE ON participant_passkey_attempt
WHEN NEW.bucket_start IS NOT OLD.bucket_start
  OR NEW.kind IS NOT OLD.kind
  OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.attempt_count != OLD.attempt_count + 1
BEGIN
  SELECT RAISE(ABORT, 'passkey attempt state conflict');
END;

CREATE TABLE IF NOT EXISTS participant_session (
  token_hash TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL COLLATE BINARY,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 2592000000
    ),
  FOREIGN KEY (credential_id, principal_id)
    REFERENCES participant_passkey_credential(credential_id, principal_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS participant_session_principal_idx
ON participant_session(principal_id, expires_at);

CREATE INDEX IF NOT EXISTS participant_session_credential_idx
ON participant_session(credential_id);

CREATE INDEX IF NOT EXISTS participant_session_expiry_idx
ON participant_session(expires_at);

CREATE TRIGGER IF NOT EXISTS participant_session_immutable_before_update
BEFORE UPDATE ON participant_session
BEGIN
  SELECT RAISE(ABORT, 'participant session is immutable');
END;
