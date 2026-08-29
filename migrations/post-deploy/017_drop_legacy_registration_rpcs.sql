-- The guarded registration implementation now calls app_private.submit_team
-- directly. Remove the public compatibility endpoints after every old
-- application instance has drained. This works on CloudBase even though its
-- gateway does not enforce PostgreSQL function EXECUTE ACLs.

do $contract$
begin
  if to_regprocedure('app_private.submit_team(jsonb)') is null
    or to_regprocedure(
      'app_private.submit_team_rate_limited(text,jsonb)'
    ) is null
    or to_regprocedure('app_private.require_rpc_role(text[])') is null
  then
    raise exception '017 expand private registration implementation is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    where routine.oid = to_regprocedure(
      'public.submit_team_rate_limited(text,jsonb)'
    )
      and routine.prosecdef
      and routine.prosrc like '%app_private.require_rpc_role%'
      and routine.prosrc like '%app_private.submit_team_rate_limited%'
  ) then
    raise exception '017 expand guarded registration wrapper is missing or unsafe';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    where routine.oid in (
      to_regprocedure('app_private.submit_team(jsonb)'),
      to_regprocedure('app_private.submit_team_rate_limited(text,jsonb)')
    )
      and routine.prosecdef
  ) then
    raise exception '017 expand private registration implementation must use invoker rights';
  end if;
end
$contract$;

drop function if exists public.submit_team(jsonb);
drop function if exists public.recent_registration_attempts(text, integer);

notify pgrst, 'reload schema';
