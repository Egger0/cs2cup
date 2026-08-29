-- Security-definer routines must resolve built-ins from pg_catalog before the
-- application schema. Every application table reference inside these routines
-- is schema-qualified, and request roles cannot create objects in public.
alter function public.submit_team(jsonb)
  set search_path = pg_catalog, public;
alter function public.recent_registration_attempts(text, integer)
  set search_path = pg_catalog, public;
alter function public.set_team_seed(bigint, bigint, integer)
  set search_path = pg_catalog, public;
alter function public.replace_bracket(bigint, bigint[], integer[])
  set search_path = pg_catalog, public;
alter function public.save_match_score(bigint, bigint, bigint, integer, integer)
  set search_path = pg_catalog, public;
alter function public.save_match_report(bigint, bigint, bigint, jsonb)
  set search_path = pg_catalog, public;
alter function public.replace_match_schedule(
  bigint,
  bigint[],
  timestamptz[],
  timestamptz[]
) set search_path = pg_catalog, public;

notify pgrst, 'reload schema';
