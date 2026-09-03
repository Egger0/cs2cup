CREATE TABLE IF NOT EXISTS identity_account (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  webauthn_user_handle TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(webauthn_user_handle) = 43
      AND webauthn_user_handle NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  display_name TEXT NOT NULL
    CHECK (
      length(display_name) BETWEEN 1 AND 80
      AND display_name = trim(display_name)
    ),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'active',
        'locked',
        'merging',
        'merged',
        'deletion_pending',
        'deleted'
      )
    ),
  verification_state TEXT NOT NULL COLLATE BINARY
    CHECK (verification_state IN ('legacy_unverified', 'verified')),
  security_version INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(security_version) = 'integer' AND security_version >= 0),
  merged_into_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  locked_at INTEGER
    CHECK (
      locked_at IS NULL
      OR (typeof(locked_at) = 'integer' AND locked_at >= created_at)
    ),
  deletion_requested_at INTEGER
    CHECK (
      deletion_requested_at IS NULL
      OR (
        typeof(deletion_requested_at) = 'integer'
        AND deletion_requested_at >= created_at
      )
    ),
  deleted_at INTEGER
    CHECK (
      deleted_at IS NULL
      OR (
        typeof(deleted_at) = 'integer'
        AND deleted_at >= created_at
        AND deletion_requested_at IS NOT NULL
        AND deleted_at >= deletion_requested_at
      )
    ),
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
  UNIQUE (webauthn_user_handle),
  CHECK (merged_into_id IS NULL OR merged_into_id != id),
  CHECK (
    (status = 'merged' AND merged_into_id IS NOT NULL)
    OR (status != 'merged' AND merged_into_id IS NULL)
  ),
  CHECK (
    (status = 'locked' AND locked_at IS NOT NULL)
    OR (status != 'locked' AND locked_at IS NULL)
  ),
  CHECK (
    (status IN ('deletion_pending', 'deleted') AND deletion_requested_at IS NOT NULL)
    OR (status NOT IN ('deletion_pending', 'deleted') AND deletion_requested_at IS NULL)
  ),
  CHECK (
    (status = 'deleted' AND deleted_at IS NOT NULL)
    OR (status != 'deleted' AND deleted_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_account_write_nonce_idx
ON identity_account(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_account_status_idx
ON identity_account(status, created_at);

CREATE TRIGGER IF NOT EXISTS identity_account_update_guard
BEFORE UPDATE ON identity_account
WHEN NEW.id IS NOT OLD.id
  OR NEW.webauthn_user_handle IS NOT OLD.webauthn_user_handle
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.updated_at < OLD.updated_at
  OR NEW.security_version < OLD.security_version
  OR (OLD.verification_state = 'verified' AND NEW.verification_state != 'verified')
  OR (
    NEW.status IS NOT OLD.status
    AND NOT (
      (OLD.status = 'pending'
        AND NEW.status IN ('active', 'locked', 'deletion_pending'))
      OR
      (OLD.status = 'active'
        AND NEW.status IN ('locked', 'merging', 'merged', 'deletion_pending'))
      OR
      (OLD.status = 'locked' AND NEW.status IN ('active', 'deletion_pending'))
      OR
      (OLD.status = 'merging' AND NEW.status IN ('active', 'merged'))
      OR
      (OLD.status = 'deletion_pending' AND NEW.status IN ('active', 'deleted'))
    )
  )
  OR (
    NEW.status IS NOT OLD.status
    AND NEW.status IN ('locked', 'merging', 'merged', 'deletion_pending', 'deleted')
    AND NEW.security_version != OLD.security_version + 1
  )
  OR OLD.status IN ('merged', 'deleted')
BEGIN
  SELECT RAISE(ABORT, 'identity account revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_account_fresh_insert_guard
BEFORE INSERT ON identity_account
WHEN NEW.status NOT IN ('pending', 'active')
  OR NEW.security_version != 0
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NEW.merged_into_id IS NOT NULL
  OR NEW.locked_at IS NOT NULL
  OR NEW.deletion_requested_at IS NOT NULL
  OR NEW.deleted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'identity account must start fresh');
END;

CREATE TRIGGER IF NOT EXISTS identity_account_merge_target_guard
BEFORE UPDATE ON identity_account
WHEN NEW.status = 'merged'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_account AS target
    WHERE target.id = NEW.merged_into_id
      AND target.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'identity account merge target must be active');
END;

CREATE TRIGGER IF NOT EXISTS identity_account_delete_guard
BEFORE DELETE ON identity_account
BEGIN
  SELECT RAISE(ABORT, 'identity accounts are retained');
END;

CREATE TABLE IF NOT EXISTS identity_verified_identity (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  adapter_kind TEXT NOT NULL COLLATE BINARY
    CHECK (adapter_kind IN ('oidc', 'cas', 'email_otp', 'legacy')),
  provider TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(provider) BETWEEN 1 AND 64
      AND provider = trim(provider)
      AND provider = lower(provider)
      AND provider GLOB '[a-z]*'
      AND provider NOT GLOB '*[^a-z0-9_.-]*'
    ),
  issuer TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(issuer) BETWEEN 1 AND 500
      AND issuer = trim(issuer)
    ),
  subject TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(subject) BETWEEN 1 AND 500
      AND subject = trim(subject)
    ),
  identity_key_version INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(identity_key_version) = 'integer' AND identity_key_version >= 1),
  -- Versioned HMAC of the framed provider + issuer + subject identity key. The key is not in D1.
  identity_key_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(identity_key_hash) = 64
      AND identity_key_hash NOT GLOB '*[^0-9a-f]*'
    ),
  display_hint TEXT NOT NULL
    CHECK (
      length(display_hint) BETWEEN 1 AND 160
      AND display_hint = trim(display_hint)
    ),
  recovery_capable INTEGER NOT NULL DEFAULT 1
    CHECK (recovery_capable IN (0, 1)),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'superseded')),
  verified_at INTEGER NOT NULL
    CHECK (typeof(verified_at) = 'integer' AND verified_at >= 0),
  last_used_at INTEGER
    CHECK (
      last_used_at IS NULL
      OR (typeof(last_used_at) = 'integer' AND last_used_at >= verified_at)
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= verified_at)
    ),
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
  UNIQUE (provider, issuer, subject),
  UNIQUE (identity_key_version, identity_key_hash),
  UNIQUE (id, account_id),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status != 'active' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_verified_identity_account_idx
ON identity_verified_identity(account_id, status, verified_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_verified_identity_write_nonce_idx
ON identity_verified_identity(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_verified_identity_update_guard
BEFORE UPDATE ON identity_verified_identity
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.adapter_kind IS NOT OLD.adapter_kind
  OR NEW.provider IS NOT OLD.provider
  OR NEW.issuer IS NOT OLD.issuer
  OR NEW.subject IS NOT OLD.subject
  OR NEW.identity_key_version IS NOT OLD.identity_key_version
  OR NEW.identity_key_hash IS NOT OLD.identity_key_hash
  OR NEW.verified_at IS NOT OLD.verified_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status != 'active'
  OR (
    OLD.last_used_at IS NOT NULL
    AND (NEW.last_used_at IS NULL OR NEW.last_used_at < OLD.last_used_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'verified identity revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_passkey_credential (
  credential_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(credential_id) BETWEEN 1 AND 1366
      AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  registration_kind TEXT NOT NULL COLLATE BINARY
    CHECK (registration_kind IN ('ceremony', 'legacy_migration')),
  registration_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  public_key BLOB NOT NULL
    CHECK (typeof(public_key) = 'blob' AND length(public_key) BETWEEN 1 AND 8192),
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
  label TEXT
    CHECK (
      label IS NULL
      OR (length(label) BETWEEN 1 AND 80 AND label = trim(label))
    ),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'compromised')),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  last_used_at INTEGER
    CHECK (
      last_used_at IS NULL
      OR (typeof(last_used_at) = 'integer' AND last_used_at >= created_at)
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)
    ),
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
  UNIQUE (credential_id, account_id),
  CHECK (
    (registration_kind = 'ceremony' AND registration_auth_intent_id IS NOT NULL)
    OR (registration_kind = 'legacy_migration' AND registration_auth_intent_id IS NULL)
  ),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status != 'active' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_passkey_credential_account_idx
ON identity_passkey_credential(account_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_passkey_credential_write_nonce_idx
ON identity_passkey_credential(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_passkey_credential_update_guard
BEFORE UPDATE ON identity_passkey_credential
WHEN NEW.credential_id IS NOT OLD.credential_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.registration_kind IS NOT OLD.registration_kind
  OR NEW.registration_auth_intent_id IS NOT OLD.registration_auth_intent_id
  OR NEW.public_key IS NOT OLD.public_key
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.counter < OLD.counter
  OR OLD.status != 'active'
  OR (
    OLD.last_used_at IS NOT NULL
    AND (NEW.last_used_at IS NULL OR NEW.last_used_at < OLD.last_used_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'identity passkey credential revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_session (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  token_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  security_version INTEGER NOT NULL
    CHECK (typeof(security_version) = 'integer' AND security_version >= 0),
  auth_method TEXT NOT NULL COLLATE BINARY
    CHECK (
      auth_method IN (
        'passkey',
        'oidc',
        'cas',
        'email_otp',
        'recovery_code',
        'assisted_recovery',
        'bootstrap'
      )
    ),
  authenticator_credential_id TEXT COLLATE BINARY,
  passkey_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  recovery_code_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_recovery_code(id) ON DELETE RESTRICT,
  recovery_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  last_seen_at INTEGER NOT NULL
    CHECK (typeof(last_seen_at) = 'integer' AND last_seen_at >= created_at),
  idle_expires_at INTEGER NOT NULL
    CHECK (typeof(idle_expires_at) = 'integer' AND idle_expires_at > last_seen_at),
  absolute_expires_at INTEGER NOT NULL
    CHECK (
      typeof(absolute_expires_at) = 'integer'
      AND absolute_expires_at >= idle_expires_at
      AND absolute_expires_at <= created_at + 2592000000
    ),
  authenticated_at INTEGER NOT NULL
    CHECK (
      typeof(authenticated_at) = 'integer'
      AND authenticated_at BETWEEN created_at AND last_seen_at
    ),
  phishing_resistant_at INTEGER
    CHECK (
      phishing_resistant_at IS NULL
      OR (
        typeof(phishing_resistant_at) = 'integer'
        AND phishing_resistant_at BETWEEN created_at AND last_seen_at
      )
    ),
  recovery_verified_at INTEGER
    CHECK (
      recovery_verified_at IS NULL
      OR (
        typeof(recovery_verified_at) = 'integer'
        AND recovery_verified_at BETWEEN created_at AND last_seen_at
      )
    ),
  recovery_restricted INTEGER NOT NULL DEFAULT 0
    CHECK (recovery_restricted IN (0, 1)),
  display_metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(display_metadata_json) <= 2048
      AND CASE
        WHEN json_valid(display_metadata_json) THEN json_type(display_metadata_json) = 'object'
        ELSE 0
      END
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)
    ),
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 160 AND revoke_reason = trim(revoke_reason))
    ),
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
  FOREIGN KEY (authenticator_credential_id, account_id)
    REFERENCES identity_passkey_credential(credential_id, account_id) ON DELETE RESTRICT,
  CHECK (
    (auth_method = 'passkey'
      AND authenticator_credential_id IS NOT NULL
      AND passkey_auth_intent_id IS NOT NULL)
    OR
    (auth_method != 'passkey'
      AND authenticator_credential_id IS NULL
      AND passkey_auth_intent_id IS NULL)
  ),
  CHECK (
    (auth_method = 'recovery_code' AND recovery_code_id IS NOT NULL)
    OR (auth_method != 'recovery_code' AND recovery_code_id IS NULL)
  ),
  CHECK (
    (auth_method = 'passkey' AND phishing_resistant_at IS NOT NULL)
    OR (auth_method != 'passkey' AND phishing_resistant_at IS NULL)
  ),
  CHECK (
    (recovery_auth_intent_id IS NOT NULL
      AND recovery_verified_at IS NOT NULL
      AND recovery_restricted = 1)
    OR
    (recovery_auth_intent_id IS NULL
      AND recovery_verified_at IS NULL
      AND recovery_restricted = 0)
  ),
  CHECK (
    recovery_restricted = 0
    OR auth_method IN ('oidc', 'cas', 'email_otp', 'recovery_code', 'assisted_recovery')
  ),
  CHECK (
    auth_method NOT IN ('recovery_code', 'assisted_recovery')
    OR recovery_restricted = 1
  ),
  CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_session_account_idx
ON identity_session(account_id, revoked_at, absolute_expires_at);

CREATE INDEX IF NOT EXISTS identity_session_expiry_idx
ON identity_session(idle_expires_at, absolute_expires_at)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_session_write_nonce_idx
ON identity_session(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_session_security_version_insert_guard
BEFORE INSERT ON identity_session
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_account
  WHERE id = NEW.account_id
    AND status = 'active'
    AND security_version = NEW.security_version
)
BEGIN
  SELECT RAISE(ABORT, 'identity session account state or security version mismatch');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_passkey_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'passkey'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_passkey_credential AS credential
    JOIN identity_auth_intent AS passkey_intent
      ON passkey_intent.id = NEW.passkey_auth_intent_id
    WHERE credential.credential_id = NEW.authenticator_credential_id
      AND credential.account_id = NEW.account_id
      AND credential.status = 'active'
      AND passkey_intent.purpose IN ('passkey_sign_in', 'passkey_step_up')
      AND (passkey_intent.expected_account_id IS NULL
        OR passkey_intent.expected_account_id = NEW.account_id)
      AND passkey_intent.consumed_at = NEW.authenticated_at
      AND passkey_intent.completion_result_type = 'passkey_credential'
      AND passkey_intent.completion_result_ref = credential.credential_id
      AND NEW.phishing_resistant_at = passkey_intent.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed passkey ceremony');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_assisted_recovery_disabled
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'assisted_recovery'
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery is not enabled');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_update_guard
BEFORE UPDATE ON identity_session
WHEN NEW.id IS NOT OLD.id
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.security_version IS NOT OLD.security_version
  OR NEW.auth_method IS NOT OLD.auth_method
  OR NEW.authenticator_credential_id IS NOT OLD.authenticator_credential_id
  OR NEW.passkey_auth_intent_id IS NOT OLD.passkey_auth_intent_id
  OR NEW.recovery_code_id IS NOT OLD.recovery_code_id
  OR NEW.recovery_auth_intent_id IS NOT OLD.recovery_auth_intent_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.absolute_expires_at IS NOT OLD.absolute_expires_at
  OR NEW.authenticated_at IS NOT OLD.authenticated_at
  OR NEW.phishing_resistant_at IS NOT OLD.phishing_resistant_at
  OR NEW.recovery_verified_at IS NOT OLD.recovery_verified_at
  OR NEW.recovery_restricted IS NOT OLD.recovery_restricted
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.last_seen_at < OLD.last_seen_at
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'identity session revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_auth_intent (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  secret_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(secret_hash) = 64
      AND secret_hash NOT GLOB '*[^0-9a-f]*'
    ),
  purpose TEXT NOT NULL COLLATE BINARY
    CHECK (
      purpose IN (
        'enrollment',
        'sign_in',
        'recovery',
        'identity_link',
        'invitation_acceptance',
        'sensitive_confirmation',
        'legacy_registration_attach',
        'passkey_enrollment',
        'passkey_sign_in',
        'passkey_step_up'
      )
    ),
  expected_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  verified_identity_id TEXT COLLATE BINARY
    REFERENCES identity_verified_identity(id) ON DELETE RESTRICT,
  passkey_challenge_hash TEXT COLLATE BINARY
    CHECK (
      passkey_challenge_hash IS NULL
      OR (
        length(passkey_challenge_hash) = 64
        AND passkey_challenge_hash NOT GLOB '*[^0-9a-f]*'
      )
    ),
  initiating_session_id TEXT COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  redirect_key TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(redirect_key) BETWEEN 1 AND 64
      AND redirect_key = lower(redirect_key)
      AND redirect_key GLOB '[a-z]*'
      AND redirect_key NOT GLOB '*[^a-z0-9_-]*'
    ),
  flow_id TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(flow_id) = 43
      AND flow_id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  idempotency_key TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(idempotency_key) = 64
      AND idempotency_key NOT GLOB '*[^0-9a-f]*'
    ),
  context_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(context_json) <= 8192
      AND CASE
        WHEN json_valid(context_json) THEN json_type(context_json) = 'object'
        ELSE 0
      END
    ),
  risk_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(risk_json) <= 2048
      AND CASE
        WHEN json_valid(risk_json) THEN json_type(risk_json) = 'object'
        ELSE 0
      END
    ),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5
    CHECK (typeof(max_attempts) = 'integer' AND max_attempts BETWEEN 1 AND 10),
  last_attempt_at INTEGER
    CHECK (
      last_attempt_at IS NULL
      OR (typeof(last_attempt_at) = 'integer' AND last_attempt_at >= 0)
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 86400000
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
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (
        length(consume_nonce) = 43
        AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  completion_result_type TEXT COLLATE BINARY
    CHECK (
      completion_result_type IS NULL
      OR (
        length(completion_result_type) BETWEEN 1 AND 64
        AND completion_result_type = lower(completion_result_type)
        AND completion_result_type GLOB '[a-z]*'
        AND completion_result_type NOT GLOB '*[^a-z0-9_-]*'
      )
    ),
  completion_result_ref TEXT COLLATE BINARY
    CHECK (
      completion_result_ref IS NULL
      OR length(completion_result_ref) BETWEEN 1 AND 500
    ),
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
  UNIQUE (purpose, secret_hash),
  UNIQUE (purpose, idempotency_key),
  UNIQUE (purpose, passkey_challenge_hash),
  CHECK (
    purpose NOT IN (
      'recovery',
      'identity_link',
      'invitation_acceptance',
      'sensitive_confirmation',
      'legacy_registration_attach',
      'passkey_enrollment',
      'passkey_step_up'
    )
    OR expected_account_id IS NOT NULL
  ),
  CHECK (
    (purpose IN ('passkey_enrollment', 'passkey_sign_in', 'passkey_step_up')
      AND passkey_challenge_hash IS NOT NULL
      AND expires_at <= created_at + 300000)
    OR
    (purpose NOT IN ('passkey_enrollment', 'passkey_sign_in', 'passkey_step_up')
      AND passkey_challenge_hash IS NULL)
  ),
  CHECK (
    (purpose = 'passkey_step_up' AND initiating_session_id IS NOT NULL)
    OR (purpose != 'passkey_step_up' AND initiating_session_id IS NULL)
  ),
  CHECK (attempt_count <= max_attempts),
  CHECK (last_attempt_at IS NULL OR last_attempt_at >= created_at),
  CHECK (
    (consumed_at IS NULL
      AND consume_nonce IS NULL
      AND completion_result_type IS NULL
      AND completion_result_ref IS NULL)
    OR
    (consumed_at IS NOT NULL
      AND consume_nonce IS NOT NULL
      AND completion_result_type IS NOT NULL
      AND completion_result_ref IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_auth_intent_fresh_idx
ON identity_auth_intent(purpose, expires_at)
WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_auth_intent_account_idx
ON identity_auth_intent(expected_account_id, purpose, expires_at)
WHERE expected_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_auth_intent_write_nonce_idx
ON identity_auth_intent(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_auth_intent_fresh_insert_guard
BEFORE INSERT ON identity_auth_intent
WHEN NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.completion_result_type IS NOT NULL
  OR NEW.completion_result_ref IS NOT NULL
  OR NEW.attempt_count != 0
  OR NEW.last_attempt_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'identity auth intent must start fresh');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_intent_identity_guard
BEFORE INSERT ON identity_auth_intent
WHEN NEW.expected_account_id IS NOT NULL
  AND NEW.verified_identity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identity_verified_identity
    WHERE id = NEW.verified_identity_id
      AND account_id = NEW.expected_account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'identity auth intent account mismatch');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_intent_step_up_session_guard
BEFORE INSERT ON identity_auth_intent
WHEN NEW.purpose = 'passkey_step_up'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_session AS initiating_session
    JOIN identity_account AS account ON account.id = initiating_session.account_id
    WHERE initiating_session.id = NEW.initiating_session_id
      AND initiating_session.account_id = NEW.expected_account_id
      AND initiating_session.revoked_at IS NULL
      AND initiating_session.security_version = account.security_version
      AND account.status = 'active'
      AND initiating_session.idle_expires_at > NEW.created_at
      AND initiating_session.absolute_expires_at > NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'passkey step-up requires a current account session');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_intent_update_guard
BEFORE UPDATE ON identity_auth_intent
WHEN NEW.id IS NOT OLD.id
  OR NEW.secret_hash IS NOT OLD.secret_hash
  OR NEW.purpose IS NOT OLD.purpose
  OR NEW.expected_account_id IS NOT OLD.expected_account_id
  OR NEW.verified_identity_id IS NOT OLD.verified_identity_id
  OR NEW.passkey_challenge_hash IS NOT OLD.passkey_challenge_hash
  OR NEW.initiating_session_id IS NOT OLD.initiating_session_id
  OR NEW.redirect_key IS NOT OLD.redirect_key
  OR NEW.flow_id IS NOT OLD.flow_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.context_json IS NOT OLD.context_json
  OR NEW.risk_json IS NOT OLD.risk_json
  OR NEW.max_attempts IS NOT OLD.max_attempts
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.attempt_count < OLD.attempt_count
  OR NEW.attempt_count > OLD.attempt_count + 1
  OR (
    OLD.last_attempt_at IS NOT NULL
    AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at)
  )
  OR OLD.consumed_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'identity auth intent revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_passkey_credential_registration_guard
BEFORE INSERT ON identity_passkey_credential
WHEN NEW.registration_kind = 'ceremony'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_auth_intent AS enrollment_intent
    WHERE enrollment_intent.id = NEW.registration_auth_intent_id
      AND enrollment_intent.purpose = 'passkey_enrollment'
      AND enrollment_intent.expected_account_id = NEW.account_id
      AND enrollment_intent.consumed_at IS NULL
      AND enrollment_intent.created_at <= NEW.created_at
      AND enrollment_intent.expires_at > NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'passkey credential requires an enrollment ceremony');
END;

CREATE TRIGGER IF NOT EXISTS identity_passkey_intent_completion_guard
BEFORE UPDATE ON identity_auth_intent
WHEN OLD.purpose IN ('passkey_enrollment', 'passkey_sign_in', 'passkey_step_up')
  AND OLD.consumed_at IS NULL
  AND NEW.consumed_at IS NOT NULL
  AND NOT (
    NEW.completion_result_type = 'passkey_credential'
    AND EXISTS (
      SELECT 1
      FROM identity_passkey_credential AS credential
      WHERE credential.credential_id = NEW.completion_result_ref
        AND credential.status = 'active'
        AND (OLD.expected_account_id IS NULL OR credential.account_id = OLD.expected_account_id)
        AND (
          OLD.purpose != 'passkey_enrollment'
          OR credential.registration_auth_intent_id = OLD.id
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'passkey intent completion credential mismatch');
END;

CREATE TABLE IF NOT EXISTS identity_recovery_code_set (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  verifier_key_version INTEGER NOT NULL
    CHECK (
      typeof(verifier_key_version) = 'integer'
      AND verifier_key_version BETWEEN 1 AND 255
    ),
  code_count INTEGER NOT NULL
    CHECK (typeof(code_count) = 'integer' AND code_count BETWEEN 6 AND 20),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'building'
    CHECK (status IN ('building', 'active', 'replaced', 'revoked')),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  activated_at INTEGER
    CHECK (
      activated_at IS NULL
      OR (typeof(activated_at) = 'integer' AND activated_at >= created_at)
    ),
  closed_at INTEGER
    CHECK (
      closed_at IS NULL
      OR (typeof(closed_at) = 'integer' AND closed_at >= created_at)
    ),
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
  UNIQUE (id, account_id),
  CHECK (
    (status = 'building' AND activated_at IS NULL AND closed_at IS NULL)
    OR
    (status = 'active' AND activated_at IS NOT NULL AND closed_at IS NULL)
    OR
    (status = 'replaced'
      AND activated_at IS NOT NULL
      AND closed_at IS NOT NULL
      AND closed_at >= activated_at)
    OR
    (status = 'revoked'
      AND closed_at IS NOT NULL
      AND (activated_at IS NULL OR closed_at >= activated_at))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_recovery_code_set_active_idx
ON identity_recovery_code_set(account_id)
WHERE status = 'active';

-- Building a set is a bounded, single-writer operation. This prevents abandoned or
-- concurrent generation attempts from accumulating multiple incomplete sets per account.
CREATE UNIQUE INDEX IF NOT EXISTS identity_recovery_code_set_building_idx
ON identity_recovery_code_set(account_id)
WHERE status = 'building';

CREATE INDEX IF NOT EXISTS identity_recovery_code_set_account_idx
ON identity_recovery_code_set(account_id, status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_recovery_code_set_write_nonce_idx
ON identity_recovery_code_set(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_set_fresh_insert_guard
BEFORE INSERT ON identity_recovery_code_set
WHEN NEW.status != 'building'
  OR NEW.activated_at IS NOT NULL
  OR NEW.closed_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account
    WHERE id = NEW.account_id
      AND status = 'active'
      AND verification_state = 'verified'
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code set must start fresh for a verified active account');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_set_activation_guard
BEFORE UPDATE ON identity_recovery_code_set
WHEN OLD.status = 'building'
  AND NEW.status = 'active'
  AND (
    NOT EXISTS (
      SELECT 1
      FROM identity_account
      WHERE id = OLD.account_id
        AND status = 'active'
        AND verification_state = 'verified'
    )
    OR (
      SELECT COUNT(*)
      FROM identity_recovery_code
      WHERE set_id = OLD.id
    ) != OLD.code_count
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code set is incomplete or account is unavailable');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_set_update_guard
BEFORE UPDATE ON identity_recovery_code_set
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.verifier_key_version IS NOT OLD.verifier_key_version
  OR NEW.code_count IS NOT OLD.code_count
  OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS NOT OLD.activated_at)
  OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS NOT OLD.closed_at)
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NOT (
    (OLD.status = 'building' AND NEW.status = 'active')
    OR (OLD.status = 'building' AND NEW.status = 'revoked' AND NEW.activated_at IS NULL)
    OR (OLD.status = 'active' AND NEW.status IN ('replaced', 'revoked'))
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code set revision or state conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_set_delete_guard
BEFORE DELETE ON identity_recovery_code_set
BEGIN
  SELECT RAISE(ABORT, 'recovery code sets are retained');
END;

CREATE TABLE IF NOT EXISTS identity_recovery_code (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  set_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_recovery_code_set(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL
    CHECK (typeof(ordinal) = 'integer' AND ordinal BETWEEN 0 AND 19),
  -- Versioned HMAC-SHA-256; the key version is held by the parent set and the key is not in D1.
  verifier TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(verifier) = 64
      AND verifier NOT GLOB '*[^0-9a-f]*'
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at >= created_at)
    ),
  consumed_auth_intent_id TEXT COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (
        length(consume_nonce) = 43
        AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
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
  UNIQUE (set_id, ordinal),
  CHECK (
    (consumed_at IS NULL AND consumed_auth_intent_id IS NULL AND consume_nonce IS NULL)
    OR
    (consumed_at IS NOT NULL
      AND consumed_auth_intent_id IS NOT NULL
      AND consume_nonce IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_recovery_code_available_idx
ON identity_recovery_code(set_id, verifier)
WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_recovery_code_write_nonce_idx
ON identity_recovery_code(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_recovery_code_intent_idx
ON identity_recovery_code(consumed_auth_intent_id)
WHERE consumed_auth_intent_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_fresh_insert_guard
BEFORE INSERT ON identity_recovery_code
WHEN NEW.consumed_at IS NOT NULL
  OR NEW.consumed_auth_intent_id IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_recovery_code_set AS code_set
    WHERE code_set.id = NEW.set_id
      AND code_set.status = 'building'
      AND NEW.ordinal < code_set.code_count
      AND NEW.created_at = code_set.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code must start fresh in a building set');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_consume_guard
BEFORE UPDATE ON identity_recovery_code
WHEN NEW.id IS NOT OLD.id
  OR NEW.set_id IS NOT OLD.set_id
  OR NEW.ordinal IS NOT OLD.ordinal
  OR NEW.verifier IS NOT OLD.verifier
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.consumed_auth_intent_id IS NULL
  OR NEW.consume_nonce IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_recovery_code_set AS code_set
    JOIN identity_account AS account
      ON account.id = code_set.account_id
    JOIN identity_auth_intent AS recovery_intent
      ON recovery_intent.id = NEW.consumed_auth_intent_id
    WHERE code_set.id = OLD.set_id
      AND code_set.status = 'active'
      AND account.status = 'active'
      AND account.verification_state = 'verified'
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = code_set.account_id
      AND recovery_intent.consumed_at IS NULL
      AND recovery_intent.attempt_count < recovery_intent.max_attempts
      AND recovery_intent.created_at <= NEW.consumed_at
      AND recovery_intent.expires_at > NEW.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code consumption conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_delete_guard
BEFORE DELETE ON identity_recovery_code
BEGIN
  SELECT RAISE(ABORT, 'recovery code verifiers are retained');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_intent_completion_guard
BEFORE UPDATE ON identity_auth_intent
WHEN OLD.purpose = 'recovery'
  AND OLD.consumed_at IS NULL
  AND NEW.consumed_at IS NOT NULL
  AND NOT (
    (
      NEW.completion_result_type = 'recovery_code'
      AND EXISTS (
        SELECT 1
        FROM identity_recovery_code AS recovery_code
        JOIN identity_recovery_code_set AS code_set
          ON code_set.id = recovery_code.set_id
        WHERE recovery_code.id = NEW.completion_result_ref
          AND recovery_code.consumed_auth_intent_id = OLD.id
          AND recovery_code.consumed_at = NEW.consumed_at
          AND code_set.account_id = OLD.expected_account_id
      )
    )
    OR
    (
      NEW.completion_result_type = 'verified_identity'
      AND NEW.completion_result_ref = OLD.verified_identity_id
      AND EXISTS (
        SELECT 1
        FROM identity_verified_identity AS recovery_identity
        WHERE recovery_identity.id = OLD.verified_identity_id
          AND recovery_identity.account_id = OLD.expected_account_id
          AND recovery_identity.status = 'active'
          AND recovery_identity.recovery_capable = 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery intent completion proof mismatch');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_recovery_context_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.recovery_restricted = 1
  AND NEW.auth_method != 'assisted_recovery'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_auth_intent AS recovery_intent
    WHERE recovery_intent.id = NEW.recovery_auth_intent_id
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = NEW.account_id
      AND recovery_intent.consumed_at = NEW.recovery_verified_at
      AND (
        NEW.auth_method NOT IN ('oidc', 'cas', 'email_otp')
        OR EXISTS (
          SELECT 1
          FROM identity_verified_identity AS recovery_identity
          WHERE recovery_identity.id = recovery_intent.verified_identity_id
            AND recovery_identity.account_id = NEW.account_id
            AND recovery_identity.adapter_kind = NEW.auth_method
            AND recovery_identity.status = 'active'
            AND recovery_identity.recovery_capable = 1
            AND recovery_intent.completion_result_type = 'verified_identity'
            AND recovery_intent.completion_result_ref = recovery_identity.id
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed recovery intent');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_recovery_code_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'recovery_code'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_recovery_code AS recovery_code
    JOIN identity_recovery_code_set AS code_set
      ON code_set.id = recovery_code.set_id
    JOIN identity_auth_intent AS recovery_intent
      ON recovery_intent.id = recovery_code.consumed_auth_intent_id
    WHERE recovery_code.id = NEW.recovery_code_id
      AND code_set.account_id = NEW.account_id
      AND code_set.status = 'active'
      AND recovery_code.consumed_at = NEW.recovery_verified_at
      AND recovery_intent.id = NEW.recovery_auth_intent_id
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = NEW.account_id
      AND recovery_intent.consumed_at IS NOT NULL
      AND recovery_intent.completion_result_type = 'recovery_code'
      AND recovery_intent.completion_result_ref = recovery_code.id
      AND NEW.created_at >= recovery_code.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed recovery code');
END;

CREATE TABLE IF NOT EXISTS identity_auth_attempt_window (
  bucket_start INTEGER PRIMARY KEY NOT NULL
    CHECK (
      typeof(bucket_start) = 'integer'
      AND bucket_start >= 0
      AND bucket_start % 600000 = 0
    ),
  distinct_bucket_count INTEGER NOT NULL DEFAULT 0
    CHECK (
      typeof(distinct_bucket_count) = 'integer'
      AND distinct_bucket_count BETWEEN 0 AND 2048
    ),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at = bucket_start + 600000
    )
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS identity_auth_attempt_window_expiry_idx
ON identity_auth_attempt_window(expires_at);

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_window_fresh_insert_guard
BEFORE INSERT ON identity_auth_attempt_window
WHEN NEW.distinct_bucket_count != 0
  OR NEW.bucket_start > unixepoch() * 1000
  OR NEW.expires_at <= unixepoch() * 1000
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt window must start fresh and current');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_window_update_guard
BEFORE UPDATE ON identity_auth_attempt_window
WHEN NEW.bucket_start IS NOT OLD.bucket_start
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.distinct_bucket_count != OLD.distinct_bucket_count + 1
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt window state conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_window_delete_guard
BEFORE DELETE ON identity_auth_attempt_window
WHEN OLD.expires_at > unixepoch() * 1000
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt window has not expired');
END;

CREATE TABLE IF NOT EXISTS identity_auth_attempt_bucket (
  bucket_start INTEGER NOT NULL
    REFERENCES identity_auth_attempt_window(bucket_start) ON DELETE RESTRICT,
  operation TEXT NOT NULL COLLATE BINARY
    CHECK (
      operation IN (
        'enrollment',
        'sign_in',
        'recovery',
        'identity_link',
        'invitation_acceptance',
        'sensitive_confirmation',
        'legacy_registration_attach',
        'passkey_registration',
        'passkey_authentication',
        'recovery_code'
      )
    ),
  dimension TEXT NOT NULL COLLATE BINARY
    CHECK (dimension IN ('account', 'identity', 'intent', 'device', 'network')),
  fingerprint_key_version INTEGER NOT NULL
    CHECK (
      typeof(fingerprint_key_version) = 'integer'
      AND fingerprint_key_version BETWEEN 1 AND 255
    ),
  -- Domain-separated HMAC of the normalized dimension value; never a raw identity or IP address.
  fingerprint_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(fingerprint_hash) = 64
      AND fingerprint_hash NOT GLOB '*[^0-9a-f]*'
    ),
  attempt_count INTEGER NOT NULL DEFAULT 1
    CHECK (
      typeof(attempt_count) = 'integer'
      AND attempt_count BETWEEN 1 AND 10000
    ),
  last_hit_at INTEGER NOT NULL
    CHECK (
      typeof(last_hit_at) = 'integer'
      AND last_hit_at >= bucket_start
      AND last_hit_at < bucket_start + 600000
    ),
  blocked_until INTEGER
    CHECK (
      blocked_until IS NULL
      OR (
        typeof(blocked_until) = 'integer'
        AND blocked_until >= bucket_start
        AND blocked_until <= bucket_start + 600000
      )
    ),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at = bucket_start + 600000
    ),
  PRIMARY KEY (
    bucket_start,
    operation,
    dimension,
    fingerprint_key_version,
    fingerprint_hash
  )
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS identity_auth_attempt_bucket_expiry_idx
ON identity_auth_attempt_bucket(expires_at);

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_bucket_fresh_insert_guard
BEFORE INSERT ON identity_auth_attempt_bucket
WHEN NEW.attempt_count != 1
  OR NEW.expires_at <= unixepoch() * 1000
  OR NOT EXISTS (
    SELECT 1
    FROM identity_auth_attempt_window AS attempt_window
    WHERE attempt_window.bucket_start = NEW.bucket_start
      AND attempt_window.expires_at = NEW.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt bucket must start fresh in a current window');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_bucket_after_insert
AFTER INSERT ON identity_auth_attempt_bucket
BEGIN
  UPDATE identity_auth_attempt_window
  SET distinct_bucket_count = distinct_bucket_count + 1
  WHERE bucket_start = NEW.bucket_start;
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_bucket_update_guard
BEFORE UPDATE ON identity_auth_attempt_bucket
WHEN NEW.bucket_start IS NOT OLD.bucket_start
  OR NEW.operation IS NOT OLD.operation
  OR NEW.dimension IS NOT OLD.dimension
  OR NEW.fingerprint_key_version IS NOT OLD.fingerprint_key_version
  OR NEW.fingerprint_hash IS NOT OLD.fingerprint_hash
  OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.expires_at <= unixepoch() * 1000
  OR NEW.attempt_count != OLD.attempt_count + 1
  OR NEW.last_hit_at < OLD.last_hit_at
  OR (
    OLD.blocked_until IS NOT NULL
    AND (NEW.blocked_until IS NULL OR NEW.blocked_until < OLD.blocked_until)
  )
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt bucket state conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_bucket_delete_guard
BEFORE DELETE ON identity_auth_attempt_bucket
WHEN OLD.expires_at > unixepoch() * 1000
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt bucket has not expired');
END;

CREATE TABLE IF NOT EXISTS identity_registration_membership (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  team_id INTEGER NOT NULL
    REFERENCES team(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL COLLATE BINARY
    CHECK (relationship IN ('owner', 'manager')),
  granted_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL
    CHECK (
      length(grant_reason) BETWEEN 1 AND 500
      AND grant_reason = trim(grant_reason)
    ),
  granted_at INTEGER NOT NULL
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (
      expires_at IS NULL
      OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)
    ),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)
    ),
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
  CHECK (relationship != 'owner' OR expires_at IS NULL),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_active_owner_idx
ON identity_registration_membership(team_id)
WHERE relationship = 'owner' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_active_member_idx
ON identity_registration_membership(team_id, account_id, relationship)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_registration_account_idx
ON identity_registration_membership(account_id, relationship, team_id)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_membership_write_nonce_idx
ON identity_registration_membership(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_registration_membership_update_guard
BEFORE UPDATE ON identity_registration_membership
WHEN NEW.id IS NOT OLD.id
  OR NEW.team_id IS NOT OLD.team_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.relationship IS NOT OLD.relationship
  OR NEW.granted_by_account_id IS NOT OLD.granted_by_account_id
  OR NEW.grant_reason IS NOT OLD.grant_reason
  OR NEW.granted_at IS NOT OLD.granted_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'registration membership revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_role_assignment (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  role TEXT NOT NULL COLLATE BINARY
    CHECK (role IN ('platform_owner', 'organizer', 'referee', 'check_in_operator')),
  scope_type TEXT NOT NULL COLLATE BINARY
    CHECK (scope_type IN ('platform', 'tournament')),
  scope_tournament_id INTEGER
    REFERENCES tournament(id) ON DELETE CASCADE,
  granted_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL
    CHECK (
      length(grant_reason) BETWEEN 1 AND 500
      AND grant_reason = trim(grant_reason)
    ),
  granted_at INTEGER NOT NULL
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (
      expires_at IS NULL
      OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)
    ),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)
    ),
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
  CHECK (
    (role = 'platform_owner' AND scope_type = 'platform' AND scope_tournament_id IS NULL)
    OR
    (role != 'platform_owner' AND scope_type = 'tournament' AND scope_tournament_id IS NOT NULL)
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_role_active_platform_idx
ON identity_role_assignment(account_id, role)
WHERE scope_type = 'platform' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_role_active_tournament_idx
ON identity_role_assignment(account_id, role, scope_tournament_id)
WHERE scope_type = 'tournament' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_role_tournament_idx
ON identity_role_assignment(scope_tournament_id, role, account_id)
WHERE scope_type = 'tournament' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_role_assignment_write_nonce_idx
ON identity_role_assignment(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_role_assignment_update_guard
BEFORE UPDATE ON identity_role_assignment
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.role IS NOT OLD.role
  OR NEW.scope_type IS NOT OLD.scope_type
  OR NEW.scope_tournament_id IS NOT OLD.scope_tournament_id
  OR NEW.granted_by_account_id IS NOT OLD.granted_by_account_id
  OR NEW.grant_reason IS NOT OLD.grant_reason
  OR NEW.granted_at IS NOT OLD.granted_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'role assignment revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_access_invitation (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  secret_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(secret_hash) = 64
      AND secret_hash NOT GLOB '*[^0-9a-f]*'
    ),
  intended_provider TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(intended_provider) BETWEEN 1 AND 64
      AND intended_provider = lower(intended_provider)
      AND intended_provider GLOB '[a-z]*'
      AND intended_provider NOT GLOB '*[^a-z0-9_.-]*'
    ),
  intended_issuer TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(intended_issuer) BETWEEN 1 AND 500
      AND intended_issuer = trim(intended_issuer)
    ),
  intended_identity_key_version INTEGER NOT NULL DEFAULT 1
    CHECK (
      typeof(intended_identity_key_version) = 'integer'
      AND intended_identity_key_version >= 1
    ),
  intended_identity_key_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(intended_identity_key_hash) = 64
      AND intended_identity_key_hash NOT GLOB '*[^0-9a-f]*'
    ),
  intended_display_hint TEXT NOT NULL
    CHECK (
      length(intended_display_hint) BETWEEN 1 AND 160
      AND intended_display_hint = trim(intended_display_hint)
    ),
  target_kind TEXT NOT NULL COLLATE BINARY
    CHECK (target_kind IN ('role', 'registration_membership')),
  role TEXT COLLATE BINARY
    CHECK (
      role IS NULL
      OR role IN ('platform_owner', 'organizer', 'referee', 'check_in_operator')
    ),
  relationship TEXT COLLATE BINARY
    CHECK (relationship IS NULL OR relationship IN ('owner', 'manager')),
  scope_type TEXT NOT NULL COLLATE BINARY
    CHECK (scope_type IN ('platform', 'tournament', 'registration')),
  scope_tournament_id INTEGER
    REFERENCES tournament(id) ON DELETE CASCADE,
  scope_team_id INTEGER
    REFERENCES team(id) ON DELETE CASCADE,
  inviter_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL
    CHECK (
      length(grant_reason) BETWEEN 1 AND 500
      AND grant_reason = trim(grant_reason)
    ),
  grant_expires_at INTEGER
    CHECK (
      grant_expires_at IS NULL
      OR (typeof(grant_expires_at) = 'integer' AND grant_expires_at >= 0)
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 2592000000
    ),
  accepted_by_account_id TEXT COLLATE BINARY,
  accepted_verified_identity_id TEXT COLLATE BINARY,
  accepted_at INTEGER
    CHECK (
      accepted_at IS NULL
      OR (
        typeof(accepted_at) = 'integer'
        AND accepted_at >= created_at
        AND accepted_at < expires_at
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
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)
    ),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count BETWEEN 0 AND 10),
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
  FOREIGN KEY (accepted_by_account_id)
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  FOREIGN KEY (accepted_verified_identity_id, accepted_by_account_id)
    REFERENCES identity_verified_identity(id, account_id) ON DELETE RESTRICT,
  CHECK (grant_expires_at IS NULL OR grant_expires_at > created_at),
  CHECK (
    (target_kind = 'role'
      AND relationship IS NULL
      AND scope_team_id IS NULL
      AND (
        (role = 'platform_owner'
          AND scope_type = 'platform'
          AND scope_tournament_id IS NULL)
        OR
        (role IN ('organizer', 'referee', 'check_in_operator')
          AND scope_type = 'tournament'
          AND scope_tournament_id IS NOT NULL)
      ))
    OR
    (target_kind = 'registration_membership'
      AND role IS NULL
      AND relationship IN ('owner', 'manager')
      AND scope_type = 'registration'
      AND scope_tournament_id IS NULL
      AND scope_team_id IS NOT NULL)
  ),
  CHECK (target_kind != 'registration_membership' OR relationship != 'owner' OR grant_expires_at IS NULL),
  CHECK (
    (accepted_at IS NULL
      AND accepted_by_account_id IS NULL
      AND accepted_verified_identity_id IS NULL
      AND consume_nonce IS NULL)
    OR
    (accepted_at IS NOT NULL
      AND accepted_by_account_id IS NOT NULL
      AND accepted_verified_identity_id IS NOT NULL
      AND consume_nonce IS NOT NULL)
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  ),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_invitation_active_platform_idx
ON identity_access_invitation(intended_identity_key_version, intended_identity_key_hash, role)
WHERE target_kind = 'role'
  AND scope_type = 'platform'
  AND accepted_at IS NULL
  AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_invitation_active_tournament_idx
ON identity_access_invitation(
  intended_identity_key_version,
  intended_identity_key_hash,
  role,
  scope_tournament_id
)
WHERE target_kind = 'role'
  AND scope_type = 'tournament'
  AND accepted_at IS NULL
  AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_invitation_active_registration_idx
ON identity_access_invitation(
  intended_identity_key_version,
  intended_identity_key_hash,
  relationship,
  scope_team_id
)
WHERE target_kind = 'registration_membership'
  AND accepted_at IS NULL
  AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_invitation_expiry_idx
ON identity_access_invitation(expires_at)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- SQLite forbids non-deterministic wall-clock expressions in a partial index. An expired invitation
-- therefore keeps its uniqueness slot until the reissue command atomically closes it as expired and
-- inserts its replacement. This lookup keeps that close-and-reissue operation bounded.
CREATE INDEX IF NOT EXISTS identity_invitation_target_expiry_idx
ON identity_access_invitation(
  intended_identity_key_version,
  intended_identity_key_hash,
  expires_at
)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_access_invitation_write_nonce_idx
ON identity_access_invitation(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_access_invitation_fresh_insert_guard
BEFORE INSERT ON identity_access_invitation
WHEN NEW.accepted_at IS NOT NULL
  OR NEW.accepted_by_account_id IS NOT NULL
  OR NEW.accepted_verified_identity_id IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.revoked_at IS NOT NULL
  OR NEW.revoked_by_account_id IS NOT NULL
  OR NEW.revoke_reason IS NOT NULL
  OR NEW.attempt_count != 0
BEGIN
  SELECT RAISE(ABORT, 'access invitation must start fresh');
END;

CREATE TRIGGER IF NOT EXISTS identity_access_invitation_update_guard
BEFORE UPDATE ON identity_access_invitation
WHEN NEW.id IS NOT OLD.id
  OR NEW.secret_hash IS NOT OLD.secret_hash
  OR NEW.intended_provider IS NOT OLD.intended_provider
  OR NEW.intended_issuer IS NOT OLD.intended_issuer
  OR NEW.intended_identity_key_version IS NOT OLD.intended_identity_key_version
  OR NEW.intended_identity_key_hash IS NOT OLD.intended_identity_key_hash
  OR NEW.intended_display_hint IS NOT OLD.intended_display_hint
  OR NEW.target_kind IS NOT OLD.target_kind
  OR NEW.role IS NOT OLD.role
  OR NEW.relationship IS NOT OLD.relationship
  OR NEW.scope_type IS NOT OLD.scope_type
  OR NEW.scope_tournament_id IS NOT OLD.scope_tournament_id
  OR NEW.scope_team_id IS NOT OLD.scope_team_id
  OR NEW.inviter_account_id IS NOT OLD.inviter_account_id
  OR NEW.grant_reason IS NOT OLD.grant_reason
  OR NEW.grant_expires_at IS NOT OLD.grant_expires_at
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.attempt_count < OLD.attempt_count
  OR NEW.attempt_count > OLD.attempt_count + 1
  OR OLD.accepted_at IS NOT NULL
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'access invitation revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_access_invitation_acceptance_identity_guard
BEFORE UPDATE ON identity_access_invitation
WHEN OLD.accepted_at IS NULL
  AND NEW.accepted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identity_verified_identity AS accepted_identity
    JOIN identity_account AS accepted_account
      ON accepted_account.id = accepted_identity.account_id
    WHERE accepted_identity.id = NEW.accepted_verified_identity_id
      AND accepted_identity.account_id = NEW.accepted_by_account_id
      AND accepted_identity.status = 'active'
      AND accepted_account.status = 'active'
      AND accepted_identity.provider = NEW.intended_provider
      AND accepted_identity.issuer = NEW.intended_issuer
      AND accepted_identity.identity_key_version = NEW.intended_identity_key_version
      AND accepted_identity.identity_key_hash = NEW.intended_identity_key_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'access invitation verified identity mismatch');
END;

CREATE TABLE IF NOT EXISTS identity_security_event (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  event_type TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(event_type) BETWEEN 3 AND 96
      AND event_type = lower(event_type)
      AND event_type GLOB '[a-z]*'
      AND event_type NOT GLOB '*[^a-z0-9_.-]*'
    ),
  severity TEXT NOT NULL COLLATE BINARY DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  actor_type TEXT NOT NULL COLLATE BINARY
    CHECK (actor_type IN ('account', 'system', 'anonymous')),
  actor_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  target_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  actor_session_id TEXT COLLATE BINARY
    CHECK (
      actor_session_id IS NULL
      OR (
        length(actor_session_id) = 43
        AND actor_session_id NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  resource_type TEXT COLLATE BINARY
    CHECK (
      resource_type IS NULL
      OR (
        length(resource_type) BETWEEN 1 AND 64
        AND resource_type = lower(resource_type)
        AND resource_type GLOB '[a-z]*'
        AND resource_type NOT GLOB '*[^a-z0-9_.-]*'
      )
    ),
  resource_id TEXT COLLATE BINARY
    CHECK (resource_id IS NULL OR length(resource_id) BETWEEN 1 AND 500),
  request_correlation_id TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    ),
  deduplication_key TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(deduplication_key) = 64
      AND deduplication_key NOT GLOB '*[^0-9a-f]*'
    ),
  network_context_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(network_context_json) <= 2048
      AND CASE
        WHEN json_valid(network_context_json) THEN json_type(network_context_json) = 'object'
        ELSE 0
      END
    ),
  details_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(details_json) <= 8192
      AND CASE
        WHEN json_valid(details_json) THEN json_type(details_json) = 'object'
        ELSE 0
      END
    ),
  retention_class TEXT NOT NULL COLLATE BINARY DEFAULT 'account_security'
    CHECK (retention_class IN ('account_security', 'access_control', 'anonymous_sampled')),
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    CHECK (typeof(recorded_at) = 'integer' AND recorded_at >= 0),
  retention_until INTEGER
    CHECK (
      retention_until IS NULL
      OR (typeof(retention_until) = 'integer' AND retention_until > recorded_at)
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  CHECK (
    (actor_type = 'account' AND actor_account_id IS NOT NULL)
    OR (actor_type != 'account' AND actor_account_id IS NULL)
  ),
  CHECK (
    (retention_class IN ('account_security', 'access_control')
      AND retention_until IS NULL)
    OR
    (retention_class = 'anonymous_sampled'
      AND actor_type = 'anonymous'
      AND target_account_id IS NULL
      AND actor_session_id IS NULL
      AND event_type GLOB 'anonymous.*'
      AND retention_until IS NOT NULL
      AND retention_until >= recorded_at + 604800000)
  ),
  CHECK (
    (resource_type IS NULL AND resource_id IS NULL)
    OR resource_type = 'platform'
    OR (resource_type IS NOT NULL AND resource_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS identity_security_event_actor_idx
ON identity_security_event(actor_account_id, created_at DESC)
WHERE actor_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_security_event_target_idx
ON identity_security_event(target_account_id, created_at DESC)
WHERE target_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_security_event_resource_idx
ON identity_security_event(resource_type, resource_id, created_at DESC)
WHERE resource_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS identity_security_event_retention_idx
ON identity_security_event(retention_class, retention_until)
WHERE retention_until IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_security_event_recorded_at_guard
BEFORE INSERT ON identity_security_event
WHEN NEW.recorded_at < unixepoch() * 1000
  OR NEW.recorded_at >= (unixepoch() + 1) * 1000
BEGIN
  SELECT RAISE(ABORT, 'security event ingestion time must be database-current');
END;

CREATE TRIGGER IF NOT EXISTS identity_security_event_update_guard
BEFORE UPDATE ON identity_security_event
BEGIN
  SELECT RAISE(ABORT, 'security events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS identity_security_event_delete_guard
BEFORE DELETE ON identity_security_event
WHEN OLD.retention_until IS NULL
  OR OLD.retention_until > unixepoch() * 1000
BEGIN
  SELECT RAISE(ABORT, 'security event retention has not elapsed');
END;

CREATE TABLE IF NOT EXISTS identity_notification_outbox (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  security_event_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_security_event(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(idempotency_key) = 64
      AND idempotency_key NOT GLOB '*[^0-9a-f]*'
    ),
  channel TEXT NOT NULL COLLATE BINARY
    CHECK (channel IN ('email', 'webhook')),
  template_key TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(template_key) BETWEEN 1 AND 96
      AND template_key = lower(template_key)
      AND template_key GLOB '[a-z]*'
      AND template_key NOT GLOB '*[^a-z0-9_.-]*'
    ),
  destination_identity_id TEXT COLLATE BINARY
    REFERENCES identity_verified_identity(id) ON DELETE RESTRICT,
  destination_key_version INTEGER NOT NULL DEFAULT 1
    CHECK (
      typeof(destination_key_version) = 'integer'
      AND destination_key_version >= 1
    ),
  destination_key_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(destination_key_hash) = 64
      AND destination_key_hash NOT GLOB '*[^0-9a-f]*'
    ),
  destination_hint TEXT NOT NULL
    CHECK (
      length(destination_hint) BETWEEN 1 AND 160
      AND destination_hint = trim(destination_hint)
    ),
  payload_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(payload_json) <= 16384
      AND CASE
        WHEN json_valid(payload_json) THEN json_type(payload_json) = 'object'
        ELSE 0
      END
    ),
  encrypted_payload TEXT,
  encryption_key_version INTEGER,
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'delivered', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(attempt_count) = 'integer' AND attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8
    CHECK (typeof(max_attempts) = 'integer' AND max_attempts BETWEEN 1 AND 20),
  available_at INTEGER NOT NULL
    CHECK (typeof(available_at) = 'integer' AND available_at >= 0),
  lease_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      lease_nonce IS NULL
      OR (
        length(lease_nonce) = 43
        AND lease_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  leased_until INTEGER
    CHECK (
      leased_until IS NULL
      OR (typeof(leased_until) = 'integer' AND leased_until >= 0)
    ),
  delivered_at INTEGER
    CHECK (
      delivered_at IS NULL
      OR (typeof(delivered_at) = 'integer' AND delivered_at >= 0)
    ),
  provider_receipt TEXT
    CHECK (provider_receipt IS NULL OR length(provider_receipt) BETWEEN 1 AND 500),
  last_error_code TEXT COLLATE BINARY
    CHECK (
      last_error_code IS NULL
      OR (
        length(last_error_code) BETWEEN 1 AND 96
        AND last_error_code = lower(last_error_code)
        AND last_error_code GLOB '[a-z]*'
        AND last_error_code NOT GLOB '*[^a-z0-9_.-]*'
      )
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 2592000000
    ),
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
  CHECK (attempt_count <= max_attempts),
  CHECK (available_at BETWEEN created_at AND expires_at),
  CHECK (
    (encrypted_payload IS NULL AND encryption_key_version IS NULL)
    OR
    (encrypted_payload IS NOT NULL
      AND length(encrypted_payload) BETWEEN 1 AND 32768
      AND typeof(encryption_key_version) = 'integer'
      AND encryption_key_version > 0)
  ),
  CHECK (
    (status = 'leased' AND lease_nonce IS NOT NULL AND leased_until IS NOT NULL)
    OR (status != 'leased' AND lease_nonce IS NULL AND leased_until IS NULL)
  ),
  CHECK (leased_until IS NULL OR leased_until BETWEEN created_at AND expires_at),
  CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL AND provider_receipt IS NOT NULL)
    OR (status != 'delivered' AND delivered_at IS NULL AND provider_receipt IS NULL)
  ),
  CHECK (delivered_at IS NULL OR delivered_at BETWEEN created_at AND expires_at)
);

CREATE INDEX IF NOT EXISTS identity_notification_outbox_dispatch_idx
ON identity_notification_outbox(status, available_at, expires_at);

CREATE INDEX IF NOT EXISTS identity_notification_outbox_stale_lease_idx
ON identity_notification_outbox(status, leased_until, expires_at)
WHERE status = 'leased';

CREATE INDEX IF NOT EXISTS identity_notification_outbox_expiry_idx
ON identity_notification_outbox(expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_notification_outbox_write_nonce_idx
ON identity_notification_outbox(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_notification_outbox_fresh_insert_guard
BEFORE INSERT ON identity_notification_outbox
WHEN NEW.status != 'pending'
  OR NEW.attempt_count != 0
  OR NEW.lease_nonce IS NOT NULL
  OR NEW.leased_until IS NOT NULL
  OR NEW.delivered_at IS NOT NULL
  OR NEW.provider_receipt IS NOT NULL
  OR NEW.last_error_code IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'notification outbox row must start pending');
END;

CREATE TRIGGER IF NOT EXISTS identity_notification_outbox_destination_guard
BEFORE INSERT ON identity_notification_outbox
WHEN NEW.destination_identity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identity_verified_identity AS destination_identity
    WHERE destination_identity.id = NEW.destination_identity_id
      AND destination_identity.identity_key_version = NEW.destination_key_version
      AND destination_identity.identity_key_hash = NEW.destination_key_hash
  )
BEGIN
  SELECT RAISE(ABORT, 'notification outbox verified destination mismatch');
END;

CREATE TRIGGER IF NOT EXISTS identity_notification_outbox_update_guard
BEFORE UPDATE ON identity_notification_outbox
WHEN NEW.id IS NOT OLD.id
  OR NEW.security_event_id IS NOT OLD.security_event_id
  OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.channel IS NOT OLD.channel
  OR NEW.template_key IS NOT OLD.template_key
  OR NEW.destination_identity_id IS NOT OLD.destination_identity_id
  OR NEW.destination_key_version IS NOT OLD.destination_key_version
  OR NEW.destination_key_hash IS NOT OLD.destination_key_hash
  OR NEW.destination_hint IS NOT OLD.destination_hint
  OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.encrypted_payload IS NOT OLD.encrypted_payload
  OR NEW.encryption_key_version IS NOT OLD.encryption_key_version
  OR NEW.max_attempts IS NOT OLD.max_attempts
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.attempt_count < OLD.attempt_count
  OR NEW.attempt_count > OLD.attempt_count + 1
  OR OLD.status IN ('delivered', 'failed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'notification outbox revision conflict');
END;

CREATE TABLE IF NOT EXISTS identity_legacy_subject_map (
  subject_type TEXT NOT NULL COLLATE BINARY
    CHECK (subject_type IN ('participant_principal', 'admin_account')),
  subject_id TEXT NOT NULL COLLATE BINARY
    CHECK (
      (subject_type = 'participant_principal'
        AND length(subject_id) = 45
        AND substr(subject_id, 1, 2) = 'p_'
        AND substr(subject_id, 3) NOT GLOB '*[^A-Za-z0-9_-]*')
      OR
      (subject_type = 'admin_account'
        AND length(subject_id) BETWEEN 1 AND 20
        AND subject_id NOT GLOB '*[^0-9]*')
    ),
  account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  source_revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(source_revision) = 'integer' AND source_revision >= 0),
  source_snapshot_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(source_snapshot_hash) = 64
      AND source_snapshot_hash NOT GLOB '*[^0-9a-f]*'
    ),
  migration_version INTEGER NOT NULL
    CHECK (typeof(migration_version) = 'integer' AND migration_version >= 1),
  mapped_at INTEGER NOT NULL
    CHECK (typeof(mapped_at) = 'integer' AND mapped_at >= 0),
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
  PRIMARY KEY (subject_type, subject_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS identity_legacy_subject_map_version_idx
ON identity_legacy_subject_map(migration_version, mapped_at);

CREATE UNIQUE INDEX IF NOT EXISTS identity_legacy_subject_map_write_nonce_idx
ON identity_legacy_subject_map(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_legacy_subject_map_update_guard
BEFORE UPDATE ON identity_legacy_subject_map
WHEN NEW.subject_type IS NOT OLD.subject_type
  OR NEW.subject_id IS NOT OLD.subject_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.mapped_at IS NOT OLD.mapped_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.source_revision < OLD.source_revision
  OR (
    NEW.source_revision = OLD.source_revision
    AND NEW.source_snapshot_hash IS NOT OLD.source_snapshot_hash
  )
  OR (
    NEW.source_revision > OLD.source_revision
    AND NEW.source_snapshot_hash IS OLD.source_snapshot_hash
  )
  OR NEW.migration_version < OLD.migration_version
BEGIN
  SELECT RAISE(ABORT, 'legacy subject map revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_legacy_subject_map_delete_guard
BEFORE DELETE ON identity_legacy_subject_map
BEGIN
  SELECT RAISE(ABORT, 'legacy subject mappings are retained');
END;

CREATE TABLE IF NOT EXISTS identity_cutover (
  account_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  phase INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(phase) = 'integer' AND phase BETWEEN 0 AND 3),
  cohort_key TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(cohort_key) BETWEEN 1 AND 64
      AND cohort_key = lower(cohort_key)
      AND cohort_key GLOB '[a-z]*'
      AND cohort_key NOT GLOB '*[^a-z0-9_-]*'
    ),
  migration_version INTEGER NOT NULL
    CHECK (typeof(migration_version) = 'integer' AND migration_version >= 1),
  ready_at INTEGER,
  active_at INTEGER,
  target_only_at INTEGER,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
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
  CHECK (
    (phase = 0 AND ready_at IS NULL AND active_at IS NULL AND target_only_at IS NULL)
    OR
    (phase = 1 AND ready_at IS NOT NULL AND active_at IS NULL AND target_only_at IS NULL)
    OR
    (phase = 2 AND ready_at IS NOT NULL AND active_at IS NOT NULL AND target_only_at IS NULL)
    OR
    (phase = 3 AND ready_at IS NOT NULL AND active_at IS NOT NULL AND target_only_at IS NOT NULL)
  ),
  CHECK (ready_at IS NULL OR (typeof(ready_at) = 'integer' AND ready_at >= created_at)),
  CHECK (active_at IS NULL OR (typeof(active_at) = 'integer' AND active_at >= ready_at)),
  CHECK (
    target_only_at IS NULL
    OR (typeof(target_only_at) = 'integer' AND target_only_at >= active_at)
  )
);

CREATE INDEX IF NOT EXISTS identity_cutover_cohort_idx
ON identity_cutover(cohort_key, phase, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS identity_cutover_write_nonce_idx
ON identity_cutover(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_cutover_update_guard
BEFORE UPDATE ON identity_cutover
WHEN NEW.account_id IS NOT OLD.account_id
  OR NEW.cohort_key IS NOT OLD.cohort_key
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.phase < OLD.phase
  OR NEW.migration_version < OLD.migration_version
  OR NEW.updated_at < OLD.updated_at
  OR (OLD.ready_at IS NOT NULL AND NEW.ready_at IS NOT OLD.ready_at)
  OR (OLD.active_at IS NOT NULL AND NEW.active_at IS NOT OLD.active_at)
  OR (OLD.target_only_at IS NOT NULL AND NEW.target_only_at IS NOT OLD.target_only_at)
BEGIN
  SELECT RAISE(ABORT, 'identity cutover revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_cutover_delete_guard
BEFORE DELETE ON identity_cutover
BEGIN
  SELECT RAISE(ABORT, 'identity cutover state is monotonic');
END;

-- SQLite's INSERT OR REPLACE conflict algorithm may delete the conflicting row without running
-- DELETE triggers when recursive_triggers is disabled (the default used by D1 clients). Reject every
-- insert that would collide with protected identity state before conflict handling can replace it.
-- Commands use explicit INSERT or compare-and-swap UPDATE statements; these tables do not use UPSERT.
CREATE TRIGGER IF NOT EXISTS identity_account_insert_conflict_guard
BEFORE INSERT ON identity_account
WHEN EXISTS (
  SELECT 1 FROM identity_account AS existing
  WHERE existing.id = NEW.id
    OR existing.webauthn_user_handle = NEW.webauthn_user_handle
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'identity account insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_verified_identity_insert_conflict_guard
BEFORE INSERT ON identity_verified_identity
WHEN EXISTS (
  SELECT 1 FROM identity_verified_identity AS existing
  WHERE existing.id = NEW.id
    OR (existing.provider = NEW.provider AND existing.issuer = NEW.issuer AND existing.subject = NEW.subject)
    OR (existing.identity_key_version = NEW.identity_key_version
      AND existing.identity_key_hash = NEW.identity_key_hash)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'verified identity insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_passkey_credential_insert_conflict_guard
BEFORE INSERT ON identity_passkey_credential
WHEN EXISTS (
  SELECT 1 FROM identity_passkey_credential AS existing
  WHERE existing.credential_id = NEW.credential_id
    OR (NEW.registration_auth_intent_id IS NOT NULL
      AND existing.registration_auth_intent_id = NEW.registration_auth_intent_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'passkey credential insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_session_insert_conflict_guard
BEFORE INSERT ON identity_session
WHEN EXISTS (
  SELECT 1 FROM identity_session AS existing
  WHERE existing.id = NEW.id
    OR existing.token_hash = NEW.token_hash
    OR (NEW.passkey_auth_intent_id IS NOT NULL
      AND existing.passkey_auth_intent_id = NEW.passkey_auth_intent_id)
    OR (NEW.recovery_code_id IS NOT NULL AND existing.recovery_code_id = NEW.recovery_code_id)
    OR (NEW.recovery_auth_intent_id IS NOT NULL
      AND existing.recovery_auth_intent_id = NEW.recovery_auth_intent_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'identity session insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_intent_insert_conflict_guard
BEFORE INSERT ON identity_auth_intent
WHEN EXISTS (
  SELECT 1 FROM identity_auth_intent AS existing
  WHERE existing.id = NEW.id
    OR existing.flow_id = NEW.flow_id
    OR (existing.purpose = NEW.purpose AND existing.secret_hash = NEW.secret_hash)
    OR (existing.purpose = NEW.purpose AND existing.idempotency_key = NEW.idempotency_key)
    OR (NEW.passkey_challenge_hash IS NOT NULL
      AND existing.purpose = NEW.purpose
      AND existing.passkey_challenge_hash = NEW.passkey_challenge_hash)
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'identity auth intent insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_set_insert_conflict_guard
BEFORE INSERT ON identity_recovery_code_set
WHEN EXISTS (
  SELECT 1 FROM identity_recovery_code_set AS existing
  WHERE existing.id = NEW.id
    OR (NEW.status = 'active' AND existing.account_id = NEW.account_id AND existing.status = 'active')
    OR (NEW.status = 'building' AND existing.account_id = NEW.account_id AND existing.status = 'building')
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'recovery code set insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_recovery_code_insert_conflict_guard
BEFORE INSERT ON identity_recovery_code
WHEN EXISTS (
  SELECT 1 FROM identity_recovery_code AS existing
  WHERE existing.id = NEW.id
    OR existing.verifier = NEW.verifier
    OR (existing.set_id = NEW.set_id AND existing.ordinal = NEW.ordinal)
    OR (NEW.consumed_auth_intent_id IS NOT NULL
      AND existing.consumed_auth_intent_id = NEW.consumed_auth_intent_id)
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'recovery code insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_window_insert_conflict_guard
BEFORE INSERT ON identity_auth_attempt_window
WHEN EXISTS (
  SELECT 1 FROM identity_auth_attempt_window AS existing
  WHERE existing.bucket_start = NEW.bucket_start
)
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt window insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_auth_attempt_bucket_insert_conflict_guard
BEFORE INSERT ON identity_auth_attempt_bucket
WHEN EXISTS (
  SELECT 1 FROM identity_auth_attempt_bucket AS existing
  WHERE existing.bucket_start = NEW.bucket_start
    AND existing.operation = NEW.operation
    AND existing.dimension = NEW.dimension
    AND existing.fingerprint_key_version = NEW.fingerprint_key_version
    AND existing.fingerprint_hash = NEW.fingerprint_hash
)
BEGIN
  SELECT RAISE(ABORT, 'identity auth attempt bucket insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_registration_membership_insert_conflict_guard
BEFORE INSERT ON identity_registration_membership
WHEN EXISTS (
  SELECT 1 FROM identity_registration_membership AS existing
  WHERE existing.id = NEW.id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND existing.team_id = NEW.team_id
      AND existing.account_id = NEW.account_id
      AND existing.relationship = NEW.relationship)
    OR (NEW.revoked_at IS NULL AND NEW.relationship = 'owner'
      AND existing.revoked_at IS NULL AND existing.relationship = 'owner'
      AND existing.team_id = NEW.team_id)
)
BEGIN
  SELECT RAISE(ABORT, 'registration membership insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_role_assignment_insert_conflict_guard
BEFORE INSERT ON identity_role_assignment
WHEN EXISTS (
  SELECT 1 FROM identity_role_assignment AS existing
  WHERE existing.id = NEW.id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND NEW.scope_type = 'platform' AND existing.scope_type = 'platform'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND NEW.scope_type = 'tournament' AND existing.scope_type = 'tournament'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role
      AND existing.scope_tournament_id = NEW.scope_tournament_id)
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_access_invitation_insert_conflict_guard
BEFORE INSERT ON identity_access_invitation
WHEN EXISTS (
  SELECT 1 FROM identity_access_invitation AS existing
  WHERE existing.id = NEW.id
    OR existing.secret_hash = NEW.secret_hash
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
    OR (NEW.accepted_at IS NULL AND NEW.revoked_at IS NULL
      AND existing.accepted_at IS NULL AND existing.revoked_at IS NULL
      AND existing.intended_identity_key_version = NEW.intended_identity_key_version
      AND existing.intended_identity_key_hash = NEW.intended_identity_key_hash
      AND existing.target_kind = NEW.target_kind
      AND (
        (NEW.scope_type = 'platform' AND existing.scope_type = 'platform'
          AND existing.role = NEW.role)
        OR (NEW.scope_type = 'tournament' AND existing.scope_type = 'tournament'
          AND existing.role = NEW.role
          AND existing.scope_tournament_id = NEW.scope_tournament_id)
        OR (NEW.scope_type = 'registration' AND existing.scope_type = 'registration'
          AND existing.relationship = NEW.relationship AND existing.scope_team_id = NEW.scope_team_id)
      ))
)
BEGIN
  SELECT RAISE(ABORT, 'access invitation insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_security_event_insert_conflict_guard
BEFORE INSERT ON identity_security_event
WHEN EXISTS (
  SELECT 1 FROM identity_security_event AS existing
  WHERE existing.id = NEW.id OR existing.deduplication_key = NEW.deduplication_key
)
BEGIN
  SELECT RAISE(ABORT, 'security event insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_notification_outbox_insert_conflict_guard
BEFORE INSERT ON identity_notification_outbox
WHEN EXISTS (
  SELECT 1 FROM identity_notification_outbox AS existing
  WHERE existing.id = NEW.id
    OR existing.idempotency_key = NEW.idempotency_key
    OR (NEW.lease_nonce IS NOT NULL AND existing.lease_nonce = NEW.lease_nonce)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'notification outbox insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_legacy_subject_map_insert_conflict_guard
BEFORE INSERT ON identity_legacy_subject_map
WHEN EXISTS (
  SELECT 1 FROM identity_legacy_subject_map AS existing
  WHERE (existing.subject_type = NEW.subject_type AND existing.subject_id = NEW.subject_id)
    OR existing.account_id = NEW.account_id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'legacy subject map insert conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_cutover_insert_conflict_guard
BEFORE INSERT ON identity_cutover
WHEN EXISTS (
  SELECT 1 FROM identity_cutover AS existing
  WHERE existing.account_id = NEW.account_id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'identity cutover insert conflict');
END;
