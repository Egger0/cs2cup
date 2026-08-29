-- CloudBase blocks CREATE ROLE in managed PostgreSQL. Production admin calls
-- already use CLOUDBASE_ADMIN_KEY, while local rest-admin runs as postgres.
select 1 as cloudbase_admin_access;
