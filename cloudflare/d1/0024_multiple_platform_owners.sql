-- Platform ownership is operationally shared; retain the per-account active-role guard.
DROP INDEX IF EXISTS identity_role_single_platform_owner_idx;
