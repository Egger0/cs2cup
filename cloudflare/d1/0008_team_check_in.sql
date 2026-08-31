ALTER TABLE team
ADD COLUMN checked_in_at TEXT;

CREATE TRIGGER team_check_in_requires_approval_before_insert
BEFORE INSERT ON team
WHEN NEW.checked_in_at IS NOT NULL AND NEW.status != 'approved'
BEGIN
  SELECT RAISE(ABORT, 'team check-in requires approved status');
END;

CREATE TRIGGER team_check_in_requires_approval_before_update
BEFORE UPDATE OF status, checked_in_at ON team
WHEN NEW.checked_in_at IS NOT NULL AND NEW.status != 'approved'
BEGIN
  SELECT RAISE(ABORT, 'team check-in requires approved status');
END;
