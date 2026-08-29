create index if not exists registration_attempt_created_at_idx
  on public.registration_attempt (created_at);

create or replace function public.submit_team_rate_limited(
  p_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
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
    v_result := public.submit_team(p_payload);
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

revoke all on function public.submit_team_rate_limited(text, jsonb) from public;
revoke execute on function public.submit_team_rate_limited(text, jsonb)
  from anon, authenticated;

do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'club_admin') then
    -- Expand phase: keep the old app's submit + ledger path available until
    -- every old instance has drained. The post-deploy contraction migration
    -- removes these grants after the new RPC is serving all traffic.
    grant select, insert on table public.registration_attempt to club_admin;
    grant usage, select on sequence public.registration_attempt_id_seq to club_admin;
    grant execute on function public.submit_team(jsonb) to club_admin;
    grant execute on function public.recent_registration_attempts(text, integer) to club_admin;
    grant execute on function public.submit_team_rate_limited(text, jsonb) to club_admin;

    drop policy if exists registration_attempt_admin on public.registration_attempt;
    create policy registration_attempt_admin on public.registration_attempt
      for insert to club_admin with check (true);
  end if;
end
$migration$;

comment on function public.recent_registration_attempts(text, integer) is
  'Deprecated compatibility RPC for rolling deployments; revoke via the post-deploy contraction after old instances drain.';

notify pgrst, 'reload schema';
