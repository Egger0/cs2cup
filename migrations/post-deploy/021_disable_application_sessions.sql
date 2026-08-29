-- Cloudflare Access is now the only administrator session boundary. Retain
-- historical private records for audit/rollback safety, but remove every
-- gateway-callable application-session and provider-identity wrapper.

drop function if exists public.admit_admin_app_session(text, text, text, bytea, uuid);
drop function if exists public.authorize_admin_principal(uuid);
drop function if exists public.create_app_session(uuid, bytea, uuid);
drop function if exists public.use_app_session(bytea, bytea, uuid);
drop function if exists public.logout_app_session(bytea, uuid);
drop function if exists public.revoke_app_session(uuid, uuid, text, uuid);
drop function if exists public.revoke_principal_sessions(uuid, uuid, uuid, text, uuid);
drop function if exists public.consume_login_attempt(bytea, bytea);
drop function if exists public.clear_login_account_throttle(bytea);
drop function if exists public.cleanup_app_sessions(integer, uuid);
drop function if exists public.ensure_principal_identity(text, text, text);

do $least_privilege$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'club_admin') then
    revoke all on table public.admin_user from club_admin;
    revoke all on table public.registration_attempt from club_admin;
    revoke all on sequence public.registration_attempt_id_seq from club_admin;
  end if;
end
$least_privilege$;

drop policy if exists admin_user_admin_read on public.admin_user;
drop policy if exists registration_attempt_admin on public.registration_attempt;

comment on table app_private.app_session is
  'Historical application-session records; runtime access was removed by migration 021 after the Cloudflare Access cutover.';
