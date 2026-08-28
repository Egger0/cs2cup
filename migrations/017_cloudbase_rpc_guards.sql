-- CloudBase exposes every function in the public PostgREST schema even when
-- PostgreSQL EXECUTE was revoked. Keep privileged implementations outside that
-- schema as SECURITY INVOKER routines and expose only wrappers that validate
-- the gateway-injected JWT role inside the function body.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter function public.submit_team(jsonb) set schema app_private;
alter function public.registration_status(text) set schema app_private;
alter function public.recent_registration_attempts(text, integer) set schema app_private;
alter function public.set_team_seed(bigint, bigint, integer) set schema app_private;
alter function public.replace_bracket(bigint, bigint[], integer[]) set schema app_private;
alter function public.save_match_score(bigint, bigint, bigint, integer, integer)
  set schema app_private;
alter function public.save_match_report(bigint, bigint, bigint, jsonb)
  set schema app_private;
alter function public.replace_match_schedule(bigint, bigint[], timestamptz[], timestamptz[])
  set schema app_private;
alter function public.submit_team_rate_limited(text, jsonb) set schema app_private;

alter function app_private.submit_team(jsonb) security invoker;
alter function app_private.registration_status(text) security invoker;
alter function app_private.recent_registration_attempts(text, integer) security invoker;
alter function app_private.set_team_seed(bigint, bigint, integer) security invoker;
alter function app_private.replace_bracket(bigint, bigint[], integer[]) security invoker;
alter function app_private.save_match_score(bigint, bigint, bigint, integer, integer)
  security invoker;
alter function app_private.save_match_report(bigint, bigint, bigint, jsonb)
  security invoker;
alter function app_private.replace_match_schedule(
  bigint,
  bigint[],
  timestamptz[],
  timestamptz[]
) security invoker;
alter function app_private.submit_team_rate_limited(text, jsonb) security invoker;

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
  v_claims_text := current_setting('request.jwt.claims', true);
  if v_claims_text is not null and btrim(v_claims_text) <> '' then
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

  -- Local PostgREST uses dedicated loopback-only authenticators that stand in
  -- for CloudBase's signed gateway roles. Database owners must supply explicit
  -- claims when testing a public wrapper; ownership is never an authorization
  -- bypass for a gateway-reachable endpoint.
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

  raise exception using
    errcode = '42501',
    message = 'RPC caller is not authorized';
end;
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;

-- The guarded implementation must call the private submit routine directly;
-- the public compatibility wrapper is removed during contraction.
create or replace function app_private.submit_team_rate_limited(
  p_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, app_private
as $$
declare
  v_now                 timestamptz;
  v_attempt_count       integer;
  v_oldest_attempt_at   timestamptz;
  v_retry_after_seconds integer;
  v_attempt_id          bigint;
  v_tournament_id       bigint;
  v_result              jsonb;
  v_accepted            boolean;
begin
  if p_fingerprint is null
    or p_fingerprint !~ '^v1:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid registration fingerprint';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'registration payload must be a JSON object';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_fingerprint, 20260828)
  );
  v_now := pg_catalog.clock_timestamp();

  delete from public.registration_attempt
  where created_at <= v_now - interval '24 hours';

  select count(*)::integer, min(created_at)
  into v_attempt_count, v_oldest_attempt_at
  from public.registration_attempt
  where fingerprint = p_fingerprint
    and created_at > v_now - interval '1 hour';

  if v_attempt_count >= 3 then
    v_retry_after_seconds := greatest(
      1,
      ceil(
        extract(epoch from (v_oldest_attempt_at + interval '1 hour' - v_now))
      )::integer
    );

    return jsonb_build_object(
      'ok', false,
      'code', 'RATE_LIMITED',
      'error', '提交太频繁。每 60 分钟最多尝试 3 次，请稍后再试或联系赛事负责人。',
      'retryAfterSeconds', v_retry_after_seconds
    );
  end if;

  select id
  into v_tournament_id
  from public.tournament
  where slug = p_payload ->> 'slug'
    and status <> 'draft';

  insert into public.registration_attempt (
    fingerprint,
    tournament_id,
    accepted,
    created_at
  ) values (
    p_fingerprint,
    v_tournament_id,
    false,
    v_now
  )
  returning id into v_attempt_id;

  if v_tournament_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', '当前赛事不存在或不可报名'
    );
  end if;

  begin
    v_result := app_private.submit_team(p_payload);
  exception
    when others then
      raise warning 'rate-limited team submission failed with SQLSTATE %', sqlstate;
      v_result := jsonb_build_object(
        'ok', false,
        'code', 'SUBMISSION_FAILED',
        'error', '报名服务暂时不可用，请稍后再试；如问题持续，请联系赛事负责人。'
      );
  end;

  v_accepted := coalesce(v_result @> '{"ok": true}'::jsonb, false);

  update public.registration_attempt
  set accepted = v_accepted
  where id = v_attempt_id;

  return v_result;
end;
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;

do $private_acl$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'club_admin') then
    execute 'revoke all on schema app_private from club_admin';
    execute 'revoke all on all functions in schema app_private from club_admin';
  end if;

  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    execute 'revoke all on schema app_private from service_role';
    execute 'revoke all on all functions in schema app_private from service_role';
  end if;
end
$private_acl$;

create function public.registration_status(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['anon', 'authenticated', 'service_role']);
  return app_private.registration_status(p_slug);
end;
$$;

create function public.submit_team_rate_limited(p_fingerprint text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.submit_team_rate_limited(p_fingerprint, p_payload);
end;
$$;

create function public.submit_team(payload jsonb)
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

create function public.recent_registration_attempts(p_fingerprint text, p_minutes integer)
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

create function public.set_team_seed(
  p_tournament_id bigint,
  p_team_id bigint,
  p_seed integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.set_team_seed(p_tournament_id, p_team_id, p_seed);
end;
$$;

create function public.replace_bracket(
  p_tournament_id bigint,
  p_team_ids bigint[],
  p_seed_positions integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.replace_bracket(p_tournament_id, p_team_ids, p_seed_positions);
end;
$$;

create function public.save_match_score(
  p_match_id bigint,
  p_team_a_id bigint,
  p_team_b_id bigint,
  p_score_a integer,
  p_score_b integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.save_match_score(
    p_match_id,
    p_team_a_id,
    p_team_b_id,
    p_score_a,
    p_score_b
  );
end;
$$;

create function public.save_match_report(
  p_match_id bigint,
  p_team_a_id bigint,
  p_team_b_id bigint,
  p_maps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.save_match_report(
    p_match_id,
    p_team_a_id,
    p_team_b_id,
    p_maps
  );
end;
$$;

create function public.replace_match_schedule(
  p_tournament_id bigint,
  p_match_ids bigint[],
  p_expected_scheduled_at timestamptz[],
  p_scheduled_at timestamptz[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.replace_match_schedule(
    p_tournament_id,
    p_match_ids,
    p_expected_scheduled_at,
    p_scheduled_at
  );
end;
$$;

revoke all on function public.registration_status(text) from public;
revoke all on function public.submit_team_rate_limited(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.submit_team(jsonb) from public, anon, authenticated;
revoke all on function public.recent_registration_attempts(text, integer)
  from public, anon, authenticated;
revoke all on function public.set_team_seed(bigint, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.replace_bracket(bigint, bigint[], integer[])
  from public, anon, authenticated;
revoke all on function public.save_match_score(bigint, bigint, bigint, integer, integer)
  from public, anon, authenticated;
revoke all on function public.save_match_report(bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.replace_match_schedule(
  bigint,
  bigint[],
  timestamptz[],
  timestamptz[]
) from public, anon, authenticated;

grant execute on function public.registration_status(text) to anon, authenticated;

do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'club_admin') then
    grant execute on function public.registration_status(text) to club_admin;
    grant execute on function public.submit_team_rate_limited(text, jsonb) to club_admin;
    grant execute on function public.submit_team(jsonb) to club_admin;
    grant execute on function public.recent_registration_attempts(text, integer) to club_admin;
    grant execute on function public.set_team_seed(bigint, bigint, integer) to club_admin;
    grant execute on function public.replace_bracket(bigint, bigint[], integer[]) to club_admin;
    grant execute on function public.save_match_score(
      bigint, bigint, bigint, integer, integer
    ) to club_admin;
    grant execute on function public.save_match_report(bigint, bigint, bigint, jsonb)
      to club_admin;
    grant execute on function public.replace_match_schedule(
      bigint, bigint[], timestamptz[], timestamptz[]
    ) to club_admin;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.registration_status(text) to service_role;
    grant execute on function public.submit_team_rate_limited(text, jsonb) to service_role;
    grant execute on function public.submit_team(jsonb) to service_role;
    grant execute on function public.recent_registration_attempts(text, integer) to service_role;
    grant execute on function public.set_team_seed(bigint, bigint, integer) to service_role;
    grant execute on function public.replace_bracket(bigint, bigint[], integer[]) to service_role;
    grant execute on function public.save_match_score(
      bigint, bigint, bigint, integer, integer
    ) to service_role;
    grant execute on function public.save_match_report(bigint, bigint, bigint, jsonb)
      to service_role;
    grant execute on function public.replace_match_schedule(
      bigint, bigint[], timestamptz[], timestamptz[]
    ) to service_role;
  end if;

  -- A database that already recorded 014 contraction has no old instances to
  -- support. Do not reopen either legacy RPC while adopting these guards.
  if exists (
    select 1
    from public.schema_migration
    where phase = 'contract'
      and filename = '014_contract_registration_rate_limit.sql'
  ) then
    drop function public.submit_team(jsonb);
    drop function public.recent_registration_attempts(text, integer);
  end if;
end
$migration$;

notify pgrst, 'reload schema';
