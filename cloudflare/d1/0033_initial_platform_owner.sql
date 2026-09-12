DROP TRIGGER IF EXISTS identity_initial_platform_owner_provenance_guard;

INSERT INTO identity_role_assignment (
  id,
  account_id,
  role,
  scope_type,
  scope_tournament_id,
  granted_by_account_id,
  grant_reason,
  granted_at,
  expires_at
)
SELECT
  CASE credential.username
    WHEN 'm1ngsama' THEN 'LTmxFA35pedMIXeT85Mn-B9UGDJ5_lfGbAP0xCxT7wU'
    ELSE 'PGEX1pGGxCfRmcO_QamQmsTtwm9j5hqG3lS1TtZNXIs'
  END,
  credential.account_id,
  'platform_owner',
  'platform',
  NULL,
  NULL,
  'Initial platform owners for the unified identity cutover',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  NULL
FROM identity_password_credential AS credential
JOIN identity_account AS account ON account.id = credential.account_id
WHERE credential.username IN ('m1ngsama', 'egger0')
  AND account.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM identity_role_assignment AS existing
    WHERE existing.account_id = credential.account_id
      AND existing.role = 'platform_owner'
      AND existing.scope_type = 'platform'
      AND existing.revoked_at IS NULL
  );
