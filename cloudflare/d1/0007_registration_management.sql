ALTER TABLE team
ADD COLUMN management_token_hash TEXT;

ALTER TABLE team
ADD COLUMN management_revision INTEGER NOT NULL DEFAULT 0 CHECK (management_revision >= 0);

ALTER TABLE team
ADD COLUMN management_write_nonce TEXT;

CREATE UNIQUE INDEX team_management_token_hash_idx
ON team(management_token_hash)
WHERE management_token_hash IS NOT NULL;

CREATE UNIQUE INDEX team_tournament_name_nocase_idx
ON team(tournament_id, name COLLATE NOCASE);

CREATE UNIQUE INDEX team_tournament_tag_nocase_idx
ON team(tournament_id, tag COLLATE NOCASE);

CREATE TRIGGER team_management_revision_increment_before_update
BEFORE UPDATE OF management_revision ON team
WHEN NEW.management_revision != OLD.management_revision + 1
  OR NEW.management_write_nonce IS NULL
  OR NEW.management_write_nonce IS OLD.management_write_nonce
BEGIN
  SELECT RAISE(ABORT, 'registration revision conflict');
END;
