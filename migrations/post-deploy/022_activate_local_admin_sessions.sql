-- The 021 contraction remains immutable history and runs after every expand
-- migration on a fresh install. Reassert the current local-authentication
-- contract after that historical Cloudflare Access cutover is applied.

do $contract$
begin
  if to_regclass('app_private.local_admin_credential') is null
    or to_regprocedure(
      'public.begin_local_admin_login(bytea,bytea,text)'
    ) is null
    or to_regprocedure(
      'public.create_local_admin_session(uuid,bigint,bytea,bytea,uuid)'
    ) is null
    or to_regprocedure(
      'public.use_local_admin_session(bytea,uuid)'
    ) is null
    or to_regprocedure(
      'public.end_local_admin_session(bytea,uuid)'
    ) is null
  then
    raise exception 'local administrator authentication is incomplete';
  end if;
end
$contract$;

comment on table app_private.app_session is
  'Private application-owned session state with idle, absolute, and revocation boundaries; local administrator sessions are active from migration 022.';

notify pgrst, 'reload schema';
