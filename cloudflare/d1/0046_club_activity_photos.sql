DROP VIEW photo_public;

CREATE TABLE photo_with_activity (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER REFERENCES tournament(id) ON DELETE CASCADE,
  activity_name TEXT,
  storage_key TEXT NOT NULL UNIQUE,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  blur_data_url TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  variant_widths TEXT NOT NULL DEFAULT '[]',
  CHECK (
    (tournament_id IS NOT NULL AND activity_name IS NULL)
    OR (tournament_id IS NULL AND activity_name IS NOT NULL
      AND length(activity_name) BETWEEN 1 AND 100 AND activity_name = trim(activity_name))
  )
);

INSERT INTO photo_with_activity
  (id, tournament_id, storage_key, width, height, blur_data_url, caption, sort_order, created_at, variant_widths)
SELECT id, tournament_id, storage_key, width, height, blur_data_url, caption, sort_order, created_at, variant_widths
FROM photo;

DROP TABLE photo;
ALTER TABLE photo_with_activity RENAME TO photo;
CREATE INDEX photo_tournament_idx ON photo(tournament_id, sort_order);

CREATE VIEW photo_public AS
SELECT p.* FROM photo p LEFT JOIN tournament t ON t.id = p.tournament_id
WHERE p.tournament_id IS NULL OR t.status != 'draft';
