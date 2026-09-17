ALTER TABLE loadout_code ADD COLUMN pending_shot_key TEXT
  CHECK (pending_shot_key IS NULL OR pending_shot_key GLOB 'loadouts/*.webp');

CREATE UNIQUE INDEX loadout_code_pending_shot_idx ON loadout_code(pending_shot_key)
  WHERE pending_shot_key IS NOT NULL;
