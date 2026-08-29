-- Contract phase for 014_registration_rate_limit.sql.
--
-- Run only after the new application version is healthy and every old
-- instance has drained. Rolling back the application after this point first
-- requires restoring the compatibility grants documented in README.md.

do $migration$
begin
  if to_regprocedure('public.submit_team_rate_limited(text,jsonb)') is null then
    raise exception 'cannot contract registration API before the guarded RPC exists';
  end if;

  if exists (select 1 from pg_roles where rolname = 'club_admin') then
    revoke all on table public.registration_attempt from club_admin;
    revoke all on sequence public.registration_attempt_id_seq from club_admin;
    revoke execute on function public.submit_team(jsonb) from club_admin;
    revoke execute on function public.recent_registration_attempts(text, integer)
      from club_admin;
    grant execute on function public.submit_team_rate_limited(text, jsonb) to club_admin;
  end if;
end
$migration$;

drop policy if exists registration_attempt_admin on public.registration_attempt;

comment on function public.recent_registration_attempts(text, integer) is
  'Deprecated compatibility RPC. Its trusted-service grant was removed by the 014 contraction.';

notify pgrst, 'reload schema';
