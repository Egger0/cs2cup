\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_runtime_function regprocedure;
  v_retired_rpc text;
begin
  if to_regclass('app_private.transaction_lock_slot') is null
    or to_regprocedure('app_private.acquire_transaction_lock(text,text)') is null
  then
    raise exception 'the Hyperdrive transaction-lock boundary is missing';
  end if;

  if (select count(*) from app_private.transaction_lock_slot) <> 4096 then
    raise exception 'the Hyperdrive transaction-lock stripe set is incomplete';
  end if;

  foreach v_runtime_function in array array[
    'app_private.submit_team(jsonb)'::regprocedure,
    'app_private.submit_team_rate_limited(text,jsonb)'::regprocedure,
    'app_private.set_team_seed(bigint,bigint,integer)'::regprocedure,
    'app_private.replace_bracket(bigint,bigint[],integer[])'::regprocedure,
    'app_private.save_match_score(bigint,bigint,bigint,integer,integer)'::regprocedure,
    'app_private.save_match_report(bigint,bigint,bigint,jsonb)'::regprocedure,
    'app_private.replace_match_schedule(bigint,bigint[],timestamptz[],timestamptz[])'::regprocedure
  ] loop
    if pg_catalog.pg_get_functiondef(v_runtime_function) ~ 'pg_advisory' then
      raise exception 'runtime function % still uses an advisory lock', v_runtime_function;
    end if;
  end loop;

  if has_table_privilege('public', 'app_private.transaction_lock_slot', 'select')
    or has_function_privilege(
      'public',
      'app_private.acquire_transaction_lock(text,text)',
      'execute'
    )
  then
    raise exception 'the private transaction-lock boundary is publicly reachable';
  end if;

  foreach v_retired_rpc in array array[
    'public.admit_admin_app_session(text,text,text,bytea,uuid)',
    'public.authorize_admin_principal(uuid)',
    'public.create_app_session(uuid,bytea,uuid)',
    'public.use_app_session(bytea,bytea,uuid)',
    'public.logout_app_session(bytea,uuid)',
    'public.revoke_app_session(uuid,uuid,text,uuid)',
    'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)',
    'public.consume_login_attempt(bytea,bytea)',
    'public.clear_login_account_throttle(bytea)',
    'public.cleanup_app_sessions(integer,uuid)',
    'public.ensure_principal_identity(text,text,text)'
  ] loop
    if to_regprocedure(v_retired_rpc) is not null then
      raise exception 'retired RPC % remains after the Access cutover', v_retired_rpc;
    end if;
  end loop;
end
$test$;

do $role_setup$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'cs2cup_hyperdrive_test') then
    create role cs2cup_hyperdrive_test
      login nosuperuser nocreatedb nocreaterole inherit noreplication nobypassrls;
  end if;
end
$role_setup$;

grant club_admin to cs2cup_hyperdrive_test;
set session authorization cs2cup_hyperdrive_test;

do $runtime_role$
begin
  if not pg_catalog.pg_has_role(session_user, 'club_admin', 'member') then
    raise exception 'the Hyperdrive login does not inherit club_admin';
  end if;

  begin
    perform public.submit_team_rate_limited('invalid', '{}'::jsonb);
    raise exception 'the invalid fingerprint unexpectedly reached the RPC';
  exception
    when sqlstate '22023' then null;
    when insufficient_privilege then
      raise exception 'the Hyperdrive login was rejected by the service RPC boundary';
  end;

  perform count(*) from public.tournament;

  if has_table_privilege(session_user, 'public.admin_user', 'select')
    or has_table_privilege(session_user, 'public.registration_attempt', 'select')
  then
    raise exception 'the Hyperdrive login retained obsolete private-table access';
  end if;
end
$runtime_role$;

reset session authorization;
rollback;

\echo 'Hyperdrive runtime tests passed'
