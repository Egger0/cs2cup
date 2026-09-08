ALTER TABLE identity_account ADD COLUMN public_handle TEXT COLLATE BINARY;

CREATE UNIQUE INDEX IF NOT EXISTS identity_account_public_handle_idx
ON identity_account(public_handle)
WHERE public_handle IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS identity_account_public_handle_insert_guard
BEFORE INSERT ON identity_account
WHEN NEW.public_handle IS NOT NULL
  AND (
    length(NEW.public_handle) < 3
    OR length(NEW.public_handle) > 30
    OR NEW.public_handle GLOB '*[^a-z0-9-]*'
    OR substr(NEW.public_handle, 1, 1) = '-'
    OR substr(NEW.public_handle, -1) = '-'
    OR NEW.public_handle IN (
      'about', 'account', 'admin', 'api', 'archive', 'games', 'guestbook', 'login', 'me',
      'media', 'news', 'players', 'recover', 'register', 'search', 'tournaments'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'public handle is not allowed');
END;

CREATE TRIGGER IF NOT EXISTS identity_account_public_handle_update_guard
BEFORE UPDATE OF public_handle ON identity_account
WHEN NEW.public_handle IS NOT NULL
  AND (
    length(NEW.public_handle) < 3
    OR length(NEW.public_handle) > 30
    OR NEW.public_handle GLOB '*[^a-z0-9-]*'
    OR substr(NEW.public_handle, 1, 1) = '-'
    OR substr(NEW.public_handle, -1) = '-'
    OR NEW.public_handle IN (
      'about', 'account', 'admin', 'api', 'archive', 'games', 'guestbook', 'login', 'me',
      'media', 'news', 'players', 'recover', 'register', 'search', 'tournaments'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'public handle is not allowed');
END;
