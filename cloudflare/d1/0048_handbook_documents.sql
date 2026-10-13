CREATE TABLE handbook_document (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('handbook', 'template')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80 AND title = trim(title)),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 300),
  storage_key TEXT UNIQUE,
  file_name TEXT,
  byte_size INTEGER,
  url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (storage_key IS NOT NULL AND file_name IS NOT NULL AND byte_size > 0 AND url IS NULL)
    OR (storage_key IS NULL AND file_name IS NULL AND byte_size IS NULL
      AND url IS NOT NULL AND url LIKE 'https://_%')
  )
);
