CREATE TABLE IF NOT EXISTS participant_principal (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 45
      AND substr(id, 1, 2) = 'p_'
      AND substr(id, 3) NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  webauthn_user_handle TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(webauthn_user_handle) = 43
      AND webauthn_user_handle NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (webauthn_user_handle)
);

CREATE TABLE IF NOT EXISTS participant_external_identity (
  id INTEGER PRIMARY KEY,
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE CASCADE,
  provider TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(provider) BETWEEN 1 AND 32
      AND provider = trim(provider)
      AND provider = lower(provider)
      AND provider GLOB '[a-z]*'
      AND provider NOT GLOB '*[^a-z0-9_-]*'
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, issuer, subject)
);

CREATE INDEX IF NOT EXISTS participant_external_identity_principal_idx
ON participant_external_identity(principal_id);

CREATE TABLE IF NOT EXISTS participant_profile (
  principal_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL
    CHECK (
      length(display_name) BETWEEN 1 AND 80
      AND display_name = trim(display_name)
    ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tournament_entry_owner (
  team_id INTEGER PRIMARY KEY
    REFERENCES team(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE RESTRICT,
  claim_method TEXT NOT NULL DEFAULT 'management_token'
    CHECK (claim_method IN ('management_token', 'verified_transfer')),
  claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tournament_entry_owner_principal_idx
ON tournament_entry_owner(principal_id);
