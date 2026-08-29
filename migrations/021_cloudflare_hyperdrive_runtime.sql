-- Hyperdrive multiplexes PostgreSQL connections and does not support advisory
-- locks or arbitrary session state. Runtime serialization therefore uses a
-- fixed set of ordinary rows, while the existing public SECURITY DEFINER RPC
-- boundary remains intact.

create table app_private.transaction_lock_slot (
  slot smallint primary key,
  constraint transaction_lock_slot_range
    check (slot between 0 and 4095)
);

insert into app_private.transaction_lock_slot (slot)
select generate_series(0, 4095)::smallint;

revoke all on app_private.transaction_lock_slot from public, anon, authenticated;

create function app_private.acquire_transaction_lock(
  p_namespace text,
  p_key text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_slot smallint;
begin
  if p_namespace is null or p_namespace = '' or p_key is null or p_key = '' then
    raise exception using
      errcode = '22023',
      message = 'transaction lock namespace and key are required';
  end if;

  v_slot := (
    (
      pg_catalog.hashtextextended(p_namespace || ':' || p_key, 20260829)
      % 4096 + 4096
    ) % 4096
  )::smallint;

  perform 1
  from app_private.transaction_lock_slot lock_slot
  where lock_slot.slot = v_slot
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'transaction lock slot is unavailable';
  end if;
end;
$$;

revoke all on function app_private.acquire_transaction_lock(text, text)
  from public, anon, authenticated;

-- Rebuild the known runtime functions from their ledgered definitions and
-- replace exactly one advisory-lock statement in each. The guard makes this
-- migration fail closed if an earlier definition ever diverges.
do $rewrite_runtime_locks$
declare
  v_signature regprocedure;
  v_replacement text;
  v_definition text;
  v_rewritten text;
  v_remaining integer;
begin
  for v_signature, v_replacement in
    select *
    from (values
      (
        'app_private.submit_team(jsonb)'::regprocedure,
        $$perform app_private.acquire_transaction_lock('registration-tournament', v_tournament.id::text);$$
      ),
      (
        'app_private.submit_team_rate_limited(text,jsonb)'::regprocedure,
        $$perform app_private.acquire_transaction_lock('registration-fingerprint', p_fingerprint);$$
      ),
      (
        'app_private.set_team_seed(bigint,bigint,integer)'::regprocedure,
        $$perform app_private.acquire_transaction_lock('match-operations', p_tournament_id::text);$$
      ),
      (
        'app_private.replace_bracket(bigint,bigint[],integer[])'::regprocedure,
        $$perform app_private.acquire_transaction_lock('match-operations', p_tournament_id::text);$$
      ),
      (
        'app_private.save_match_score(bigint,bigint,bigint,integer,integer)'::regprocedure,
        $$perform app_private.acquire_transaction_lock('match-operations', v_tournament_id::text);$$
      ),
      (
        'app_private.save_match_report(bigint,bigint,bigint,jsonb)'::regprocedure,
        $$perform app_private.acquire_transaction_lock('match-operations', v_tournament_id::text);$$
      ),
      (
        'app_private.replace_match_schedule(bigint,bigint[],timestamptz[],timestamptz[])'::regprocedure,
        $$perform app_private.acquire_transaction_lock('match-operations', p_tournament_id::text);$$
      )
    ) runtime_function(signature, replacement)
  loop
    select pg_catalog.pg_get_functiondef(v_signature)
    into v_definition;

    v_rewritten := pg_catalog.regexp_replace(
      v_definition,
      'perform[[:space:]]+(pg_catalog\.)?pg_advisory_xact_lock\([^;]+;',
      v_replacement,
      'i'
    );

    if v_rewritten = v_definition then
      raise exception 'expected advisory lock was not found in %', v_signature;
    end if;

    select count(*)::integer
    into v_remaining
    from pg_catalog.regexp_matches(
      v_rewritten,
      '(pg_catalog\.)?pg_advisory_xact_lock',
      'gi'
    );

    if v_remaining <> 0 then
      raise exception 'advisory lock remains in %', v_signature;
    end if;

    execute v_rewritten;
  end loop;
end
$rewrite_runtime_locks$;

-- A dedicated Hyperdrive login is provisioned out-of-band as a member of the
-- existing least-privilege club_admin role. Recognize that exact membership at
-- the service RPC boundary without relying on request.jwt.claims session state.
create or replace function app_private.require_rpc_role(p_allowed_roles text[])
returns void
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_claims_text text;
  v_request_role text;
begin
  v_claims_text := pg_catalog.current_setting('request.jwt.claims', true);
  if v_claims_text is not null and pg_catalog.btrim(v_claims_text) <> '' then
    begin
      v_request_role := (v_claims_text::jsonb) ->> 'role';
    exception
      when invalid_text_representation then
        v_request_role := null;
    end;
  end if;

  if v_request_role = any(coalesce(p_allowed_roles, array[]::text[])) then
    return;
  end if;

  if session_user = 'admin_authenticator'
    and 'service_role' = any(coalesce(p_allowed_roles, array[]::text[]))
  then
    return;
  end if;
  if session_user = 'anon_authenticator'
    and 'anon' = any(coalesce(p_allowed_roles, array[]::text[]))
  then
    return;
  end if;

  if exists (
    select 1 from pg_catalog.pg_roles where rolname = 'club_admin'
  )
    and pg_catalog.pg_has_role(session_user, 'club_admin', 'member')
    and 'service_role' = any(coalesce(p_allowed_roles, array[]::text[]))
  then
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'RPC caller is not authorized';
end;
$$;

revoke all on function app_private.require_rpc_role(text[])
  from public, anon, authenticated;

comment on table app_private.transaction_lock_slot is
  'Fixed row-lock stripes used by Hyperdrive-compatible runtime transactions.';
comment on function app_private.acquire_transaction_lock(text, text) is
  'Serializes a logical operation with a transaction-scoped row lock.';
