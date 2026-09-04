DELETE FROM admin_session
WHERE EXISTS (
  SELECT 1 FROM identity_legacy_subject_map AS migrated
  WHERE migrated.subject_type = 'admin_account'
    AND migrated.subject_id = CAST(admin_session.admin_id AS TEXT)
);

DELETE FROM participant_session
WHERE EXISTS (
  SELECT 1 FROM identity_legacy_subject_map AS migrated
  WHERE migrated.subject_type = 'participant_principal'
    AND migrated.subject_id = participant_session.principal_id
);

CREATE TRIGGER legacy_admin_session_cutover_insert_guard
BEFORE INSERT ON admin_session
WHEN EXISTS (
  SELECT 1 FROM identity_legacy_subject_map AS migrated
  WHERE migrated.subject_type = 'admin_account'
    AND migrated.subject_id = CAST(NEW.admin_id AS TEXT)
)
BEGIN
  SELECT RAISE(ABORT, 'legacy admin account has completed identity cutover');
END;

CREATE TRIGGER legacy_participant_session_cutover_insert_guard
BEFORE INSERT ON participant_session
WHEN EXISTS (
  SELECT 1 FROM identity_legacy_subject_map AS migrated
  WHERE migrated.subject_type = 'participant_principal'
    AND migrated.subject_id = NEW.principal_id
)
BEGIN
  SELECT RAISE(ABORT, 'legacy participant has completed identity cutover');
END;
