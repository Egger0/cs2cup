\set ON_ERROR_STOP on

begin;

set local request.jwt.claims = '{"role":"service_role"}';

do $test$
declare
  v_game_id       bigint;
  v_tournament_id bigint;
  v_slug          text := format('registration-rate-limit-test-%s', txid_current());
  v_fingerprint   text := 'v1:' || repeat('a', 64);
  v_result        jsonb;
  v_count         integer;
  v_index         integer;
  v_function      regprocedure;
begin
  v_function := to_regprocedure('public.submit_team_rate_limited(text,jsonb)');
  if v_function is null then
    raise exception 'submit_team_rate_limited is missing';
  end if;

  if has_function_privilege('anon', v_function, 'execute') then
    raise exception 'anon unexpectedly has execute privilege on %', v_function;
  end if;
  if has_function_privilege('authenticated', v_function, 'execute') then
    raise exception 'authenticated unexpectedly has execute privilege on %', v_function;
  end if;
  if exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) privilege
    where function_row.oid = v_function::oid
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC unexpectedly has execute privilege on %', v_function;
  end if;

  if exists (select 1 from pg_roles where rolname = 'club_admin') then
    if not has_function_privilege('club_admin', v_function, 'execute') then
      raise exception 'club_admin is missing execute privilege on %', v_function;
    end if;
    if to_regprocedure('public.submit_team(jsonb)') is not null then
      raise exception 'legacy submit_team RPC still exists after contraction';
    end if;
    if has_table_privilege('club_admin', 'public.registration_attempt', 'select')
      or has_table_privilege('club_admin', 'public.registration_attempt', 'insert')
      or has_table_privilege('club_admin', 'public.registration_attempt', 'update')
      or has_table_privilege('club_admin', 'public.registration_attempt', 'delete')
    then
      raise exception 'club_admin has direct access to the registration ledger';
    end if;
  end if;

  insert into public.game (slug, name, sort_order, active)
  values (v_slug, 'Registration rate-limit test game', 999, true)
  returning id into v_game_id;

  insert into public.tournament (
    slug,
    title,
    game_id,
    season,
    edition,
    status,
    team_cap
  ) values (
    v_slug,
    'Registration rate-limit test',
    v_game_id,
    '2099',
    1,
    'registration',
    16
  )
  returning id into v_tournament_id;

  for v_index in 1..3 loop
    v_result := public.submit_team_rate_limited(
      v_fingerprint,
      jsonb_build_object(
        'slug', v_slug,
        'name', format('Rate Limit Team %s', v_index),
        'tag', format('RL%s', v_index),
        'captain', 'Test Captain',
        'contact', 'test-contact',
        'players', '[]'::jsonb
      )
    );

    if v_result ->> 'ok' <> 'true' then
      raise exception 'attempt % was unexpectedly rejected: %', v_index, v_result;
    end if;
  end loop;

  v_result := public.submit_team_rate_limited(
    v_fingerprint,
    jsonb_build_object(
      'slug', v_slug,
      'name', 'Rate Limit Team 4',
      'tag', 'RL4',
      'captain', 'Test Captain',
      'contact', 'test-contact',
      'players', '[]'::jsonb
    )
  );

  if v_result ->> 'code' <> 'RATE_LIMITED'
    or (v_result ->> 'retryAfterSeconds')::integer < 1
  then
    raise exception 'fourth attempt was not rate-limited: %', v_result;
  end if;

  select count(*)::integer
  into v_count
  from public.registration_attempt
  where fingerprint = v_fingerprint;

  if v_count <> 3 then
    raise exception 'expected three consumed attempts, found %', v_count;
  end if;

  if exists (
    select 1
    from public.registration_attempt
    where fingerprint = v_fingerprint
      and not accepted
  ) then
    raise exception 'successful attempts were not marked accepted';
  end if;

  delete from public.registration_attempt where fingerprint = v_fingerprint;

  for v_index in 1..3 loop
    v_result := public.submit_team_rate_limited(
      v_fingerprint,
      jsonb_build_object(
        'slug', v_slug,
        'name', '',
        'tag', '',
        'captain', '',
        'contact', ''
      )
    );

    if v_result ->> 'ok' <> 'false' then
      raise exception 'invalid attempt % was unexpectedly accepted: %', v_index, v_result;
    end if;
  end loop;

  v_result := public.submit_team_rate_limited(
    v_fingerprint,
    jsonb_build_object(
      'slug', v_slug,
      'name', 'Valid After Invalid Attempts',
      'tag', 'VAI',
      'captain', 'Test Captain',
      'contact', 'test-contact',
      'players', '[]'::jsonb
    )
  );

  if v_result ->> 'code' <> 'RATE_LIMITED' then
    raise exception 'failed validations did not consume rate-limit capacity: %', v_result;
  end if;

  insert into public.registration_attempt (
    fingerprint,
    tournament_id,
    accepted,
    created_at
  ) values (
    'v1:' || repeat('b', 64),
    v_tournament_id,
    false,
    now() - interval '25 hours'
  );

  perform public.submit_team_rate_limited(
    'v1:' || repeat('c', 64),
    jsonb_build_object(
      'slug', v_slug,
      'name', 'Retention Test Team',
      'tag', 'RTT',
      'captain', 'Test Captain',
      'contact', 'test-contact',
      'players', '[]'::jsonb
    )
  );

  if exists (
    select 1
    from public.registration_attempt
    where fingerprint = 'v1:' || repeat('b', 64)
  ) then
    raise exception 'expired fingerprint ledger row was not removed';
  end if;

  insert into public.tournament (
    slug,
    title,
    game_id,
    season,
    edition,
    status,
    team_cap
  ) values (
    v_slug || '-draft',
    'Private draft registration test',
    v_game_id,
    '2099',
    2,
    'draft',
    16
  );

  if public.submit_team_rate_limited(
    'v1:' || repeat('d', 64),
    jsonb_build_object('slug', v_slug || '-draft')
  ) ->> 'error' is distinct from public.submit_team_rate_limited(
    'v1:' || repeat('e', 64),
    jsonb_build_object('slug', v_slug || '-missing')
  ) ->> 'error' then
    raise exception 'registration response reveals whether a draft slug exists';
  end if;

  begin
    perform public.submit_team_rate_limited(
      '203.0.113.1',
      jsonb_build_object('slug', v_slug)
    );
    raise exception 'raw IP fingerprint was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end
$test$;

rollback;
