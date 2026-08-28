-- Coordinated rollback for the registration contract set. The legacy public
-- wrappers and local compatibility ACLs are restored atomically, and only the
-- two exact contract ledger rows owned by this rollout are removed so the
-- normal contract runner can apply them again after old instances drain.

begin;

-- Share the runner's database-scoped lock so rollback and forward migrations
-- cannot mutate the ledger or compatibility wrappers concurrently.
select pg_catalog.pg_advisory_xact_lock(1129521731, 1296647246);

do $preflight$
begin
  if to_regprocedure('app_private.require_rpc_role(text[])') is null
    or to_regprocedure('app_private.submit_team(jsonb)') is null
    or to_regprocedure(
      'app_private.recent_registration_attempts(text,integer)'
    ) is null
  then
    raise exception 'private registration core is incomplete; rollback refused';
  end if;
end
$preflight$;

create or replace function public.submit_team(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.submit_team(payload);
end;
$$;

create or replace function public.recent_registration_attempts(
  p_fingerprint text,
  p_minutes integer
)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.recent_registration_attempts(p_fingerprint, p_minutes);
end;
$$;

revoke all on function public.submit_team(jsonb) from public, anon, authenticated;
revoke all on function public.recent_registration_attempts(text, integer)
  from public, anon, authenticated;

do $rollback$
begin
  if exists (select 1 from pg_roles where rolname = 'club_admin') then
    grant select, insert on table public.registration_attempt to club_admin;
    grant usage, select on sequence public.registration_attempt_id_seq to club_admin;
    grant execute on function public.submit_team(jsonb) to club_admin;
    grant execute on function public.recent_registration_attempts(text, integer) to club_admin;

    drop policy if exists registration_attempt_admin on public.registration_attempt;
    create policy registration_attempt_admin on public.registration_attempt
      for insert to club_admin with check (true);
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.submit_team(jsonb) to service_role;
    grant execute on function public.recent_registration_attempts(text, integer)
      to service_role;
  end if;
end
$rollback$;

delete from public.schema_migration
where phase = 'contract'
  and filename in (
    '014_contract_registration_rate_limit.sql',
    '017_drop_legacy_registration_rpcs.sql'
  );

notify pgrst, 'reload schema';

commit;
