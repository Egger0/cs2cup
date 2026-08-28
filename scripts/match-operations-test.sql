\set ON_ERROR_STOP on

begin;

set local request.jwt.claims = '{"role":"service_role"}';

do $test$
declare
  v_game_id          bigint;
  v_tournament_id    bigint;
  v_team_ids         bigint[];
  v_result           jsonb;
  v_count            integer;
  v_seed_a           integer[];
  v_seed_b           integer[];
  v_seed_one_half    integer;
  v_seed_two_half    integer;
  v_match_ids_before bigint[];
  v_match_ids_after  bigint[];
  v_bye_id           bigint;
  v_bye_team_id      bigint;
  v_upstream_id      bigint;
  v_upstream_a_id    bigint;
  v_upstream_b_id    bigint;
  v_later_id         bigint;
  v_later_a_id       bigint;
  v_later_b_id       bigint;
  v_other_upstream_id   bigint;
  v_other_upstream_a_id bigint;
  v_other_upstream_b_id bigint;
  v_other_later_id      bigint;
  v_other_later_a_id    bigint;
  v_other_later_b_id    bigint;
  v_final_id         bigint;
  v_final_a_id       bigint;
  v_final_b_id       bigint;
  v_score_a          integer;
  v_score_b          integer;
  v_winner_id        bigint;
  v_champion_name    text;
  v_function         regprocedure;
begin
  foreach v_function in array array[
    to_regprocedure('public.set_team_seed(bigint,bigint,integer)'),
    to_regprocedure('public.replace_bracket(bigint,bigint[],integer[])'),
    to_regprocedure('public.save_match_score(bigint,bigint,bigint,integer,integer)'),
    to_regprocedure('public.save_match_report(bigint,bigint,bigint,jsonb)')
  ]
  loop
    if v_function is null then
      raise exception 'expected match operation function is missing';
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
  end loop;

  insert into public.game (slug, name, sort_order, active)
  values (
    format('match-operations-test-%s', txid_current()),
    'Match operations test game',
    999,
    true
  )
  returning id into v_game_id;

  insert into public.tournament (
    slug,
    title,
    game_id,
    season,
    edition,
    status,
    team_cap,
    map_pool
  ) values (
    format('match-operations-test-%s', txid_current()),
    'Six-team bye test',
    v_game_id,
    '2099',
    1,
    'running',
    16,
    '["Mirage","Inferno","Ancient"]'::jsonb
  )
  returning id into v_tournament_id;

  insert into public.team (
    tournament_id,
    name,
    tag,
    captain,
    contact,
    status
  )
  select
    v_tournament_id,
    format('Test Team %s', seed_number),
    format('MO%s', seed_number),
    format('Captain %s', seed_number),
    format('test-%s', seed_number),
    'approved'
  from generate_series(1, 6) as seeds(seed_number);

  select array_agg(t.id order by t.tag)
  into v_team_ids
  from public.team t
  where t.tournament_id = v_tournament_id;

  perform public.set_team_seed(v_tournament_id, v_team_ids[1], 1);
  v_result := public.set_team_seed(v_tournament_id, v_team_ids[2], 1);

  if (v_result ->> 'swappedTeamId')::bigint <> v_team_ids[1]
    or not exists (
      select 1 from public.team where id = v_team_ids[1] and seed is null
    )
    or not exists (
      select 1 from public.team where id = v_team_ids[2] and seed = 1
    )
  then
    raise exception 'atomic seed swap returned unexpected state: %', v_result;
  end if;

  v_result := public.replace_bracket(
    v_tournament_id,
    v_team_ids,
    array[1, 8, 4, 5, 2, 7, 3, 6]
  );

  if v_result ->> 'ok' <> 'true'
    or (v_result ->> 'created')::integer <> 7
    or (v_result ->> 'byes')::integer <> 2
    or (v_result ->> 'teams')::integer <> 6
  then
    raise exception 'replace_bracket returned unexpected result: %', v_result;
  end if;

  select count(*)::integer
  into v_count
  from public.match m
  where m.tournament_id = v_tournament_id;

  if v_count <> 7 then
    raise exception 'expected 7 matches, found %', v_count;
  end if;

  select array_agg(m.id order by m.round, m.slot)
  into v_match_ids_before
  from public.match m
  where m.tournament_id = v_tournament_id;

  begin
    perform public.replace_bracket(
      v_tournament_id,
      v_team_ids[1:5],
      array[1, 8, 4, 5, 2, 7, 3, 6]
    );
    raise exception 'replace_bracket accepted an incomplete approved-team set';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.replace_bracket(
      v_tournament_id,
      v_team_ids,
      array[7, 8, 1, 2, 3, 4, 5, 6]
    );
    raise exception 'replace_bracket accepted a double-empty first-round match';
  exception
    when sqlstate '22023' then null;
  end;

  select array_agg(m.id order by m.round, m.slot)
  into v_match_ids_after
  from public.match m
  where m.tournament_id = v_tournament_id;

  if v_match_ids_after is distinct from v_match_ids_before then
    raise exception 'invalid bracket replacement changed the existing bracket';
  end if;

  select count(*)::integer
  into v_count
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.round = 0
    and m.winner_team_id is not null
    and m.score_a is null
    and m.score_b is null
    and ((m.team_a_id is null) <> (m.team_b_id is null));

  if v_count <> 2 then
    raise exception 'expected 2 automatic byes, found %', v_count;
  end if;

  select m.id, coalesce(m.team_a_id, m.team_b_id)
  into v_bye_id, v_bye_team_id
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.round = 0
    and ((m.team_a_id is null) <> (m.team_b_id is null))
  order by m.slot
  limit 1;

  v_result := public.save_match_score(
    v_bye_id,
    (select team_a_id from public.match where id = v_bye_id),
    (select team_b_id from public.match where id = v_bye_id),
    null,
    null
  );

  if (v_result ->> 'winnerTeamId')::bigint <> v_bye_team_id then
    raise exception 'clearing a bye removed its automatic winner: %', v_result;
  end if;

  select
    array_agg(coalesce(team_a.seed, 0) order by m.slot),
    array_agg(coalesce(team_b.seed, 0) order by m.slot)
  into v_seed_a, v_seed_b
  from public.match m
  left join public.team team_a on team_a.id = m.team_a_id
  left join public.team team_b on team_b.id = m.team_b_id
  where m.tournament_id = v_tournament_id
    and m.round = 0;

  if v_seed_a is distinct from array[1, 4, 2, 3]
    or v_seed_b is distinct from array[0, 5, 0, 6]
  then
    raise exception 'unexpected first-round seed pairs: A=%, B=%', v_seed_a, v_seed_b;
  end if;

  select semifinal.slot
  into v_seed_one_half
  from public.match opening
  join public.team entrant
    on entrant.id in (opening.team_a_id, opening.team_b_id)
  join public.match semifinal
    on semifinal.tournament_id = opening.tournament_id
    and semifinal.round = 1
    and opening.id in (semifinal.source_match_a_id, semifinal.source_match_b_id)
  where opening.tournament_id = v_tournament_id
    and opening.round = 0
    and entrant.seed = 1;

  select semifinal.slot
  into v_seed_two_half
  from public.match opening
  join public.team entrant
    on entrant.id in (opening.team_a_id, opening.team_b_id)
  join public.match semifinal
    on semifinal.tournament_id = opening.tournament_id
    and semifinal.round = 1
    and opening.id in (semifinal.source_match_a_id, semifinal.source_match_b_id)
  where opening.tournament_id = v_tournament_id
    and opening.round = 0
    and entrant.seed = 2;

  if v_seed_one_half is null
    or v_seed_two_half is null
    or v_seed_one_half = v_seed_two_half
  then
    raise exception 'top seeds are not in opposite halves: seed 1=%, seed 2=%',
      v_seed_one_half, v_seed_two_half;
  end if;

  select m.id, m.team_a_id, m.team_b_id
  into v_upstream_id, v_upstream_a_id, v_upstream_b_id
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.round = 0
    and m.slot = 1;

  v_result := public.save_match_score(
    v_upstream_id,
    v_upstream_a_id,
    v_upstream_b_id,
    2,
    0
  );
  if (v_result ->> 'winnerTeamId')::bigint <> v_upstream_a_id then
    raise exception 'opening-round winner did not resolve: %', v_result;
  end if;

  select
    later.id,
    coalesce(later.team_a_id, source_a.winner_team_id),
    coalesce(later.team_b_id, source_b.winner_team_id)
  into v_later_id, v_later_a_id, v_later_b_id
  from public.match later
  left join public.match source_a on source_a.id = later.source_match_a_id
  left join public.match source_b on source_b.id = later.source_match_b_id
  where later.tournament_id = v_tournament_id
    and later.round = 1
    and later.slot = 0;

  if v_later_a_id is null or v_later_b_id is null then
    raise exception 'later-round participants did not resolve: A=%, B=%',
      v_later_a_id, v_later_b_id;
  end if;

  v_result := public.save_match_score(v_later_id, v_later_a_id, v_later_b_id, 2, 0);
  if (v_result ->> 'winnerTeamId')::bigint <> v_later_a_id then
    raise exception 'later-round winner did not resolve: %', v_result;
  end if;

  v_result := public.save_match_report(
    v_later_id,
    v_later_a_id,
    v_later_b_id,
    '[
      {"mapName":"Mirage","action":"pick","chosenBy":"a","scoreA":13,"scoreB":8,"played":true},
      {"mapName":"Inferno","action":"pick","chosenBy":"b","scoreA":9,"scoreB":13,"played":true},
      {"mapName":"Ancient","action":"decider","chosenBy":null,"scoreA":13,"scoreB":11,"played":true}
    ]'::jsonb
  );

  if (v_result ->> 'scoreA')::integer <> 2
    or (v_result ->> 'scoreB')::integer <> 1
    or (v_result ->> 'winnerTeamId')::bigint <> v_later_a_id
    or (v_result ->> 'maps')::integer <> 3
  then
    raise exception 'map report returned unexpected result: %', v_result;
  end if;

  select m.score_a, m.score_b, m.winner_team_id
  into v_score_a, v_score_b, v_winner_id
  from public.match m
  where m.id = v_later_id;

  if v_score_a <> 2 or v_score_b <> 1 or v_winner_id <> v_later_a_id then
    raise exception 'map report did not persist the 2:1 result';
  end if;

  select count(*)::integer
  into v_count
  from public.match_map mm
  where mm.match_id = v_later_id;

  if v_count <> 3 then
    raise exception 'expected 3 match_map rows, found %', v_count;
  end if;

  begin
    perform public.save_match_report(
      v_later_id,
      v_later_a_id,
      v_later_b_id,
      '[
        {"mapName":"Mirage","action":"pick","chosenBy":"a","scoreA":13,"scoreB":8,"played":true},
        {"mapName":"Mirage","action":"pick","chosenBy":"b","scoreA":9,"scoreB":13,"played":true}
      ]'::jsonb
    );
    raise exception 'save_match_report accepted a duplicate map';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.save_match_report(
      v_later_id,
      v_later_b_id,
      v_later_a_id,
      '[]'::jsonb
    );
    raise exception 'save_match_report accepted stale participant ids';
  exception
    when sqlstate '40001' then null;
  end;

  begin
    perform public.save_match_score(
      v_later_id,
      v_later_a_id,
      v_later_b_id,
      2,
      1
    );
    raise exception 'manual score unexpectedly replaced an existing map report';
  exception
    when sqlstate '22023' then null;
  end;

  select count(*)::integer
  into v_count
  from public.match_map mm
  where mm.match_id = v_later_id;

  select m.score_a, m.score_b, m.winner_team_id
  into v_score_a, v_score_b, v_winner_id
  from public.match m
  where m.id = v_later_id;

  if v_count <> 3
    or v_score_a <> 2
    or v_score_b <> 1
    or v_winner_id <> v_later_a_id
  then
    raise exception 'rejected report/score write did not preserve the prior report';
  end if;

  select m.id, m.team_a_id, m.team_b_id
  into v_other_upstream_id, v_other_upstream_a_id, v_other_upstream_b_id
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.round = 0
    and m.slot = 3;

  perform public.save_match_score(
    v_other_upstream_id,
    v_other_upstream_a_id,
    v_other_upstream_b_id,
    2,
    0
  );

  select
    later.id,
    coalesce(later.team_a_id, source_a.winner_team_id),
    coalesce(later.team_b_id, source_b.winner_team_id)
  into v_other_later_id, v_other_later_a_id, v_other_later_b_id
  from public.match later
  left join public.match source_a on source_a.id = later.source_match_a_id
  left join public.match source_b on source_b.id = later.source_match_b_id
  where later.tournament_id = v_tournament_id
    and later.round = 1
    and later.slot = 1;

  perform public.save_match_score(
    v_other_later_id,
    v_other_later_a_id,
    v_other_later_b_id,
    2,
    0
  );

  select
    final.id,
    coalesce(final.team_a_id, source_a.winner_team_id),
    coalesce(final.team_b_id, source_b.winner_team_id)
  into v_final_id, v_final_a_id, v_final_b_id
  from public.match final
  left join public.match source_a on source_a.id = final.source_match_a_id
  left join public.match source_b on source_b.id = final.source_match_b_id
  where final.tournament_id = v_tournament_id
    and final.round = 2
    and final.slot = 0;

  perform public.save_match_score(v_final_id, v_final_a_id, v_final_b_id, 3, 1);

  select t.champion_name
  into v_champion_name
  from public.tournament t
  where t.id = v_tournament_id;

  if v_champion_name is distinct from (
    select team.name from public.team team where team.id = v_final_a_id
  ) then
    raise exception 'final result did not synchronize champion_name: %', v_champion_name;
  end if;

  v_result := public.save_match_score(
    v_upstream_id,
    v_upstream_a_id,
    v_upstream_b_id,
    0,
    2
  );
  if (v_result ->> 'winnerTeamId')::bigint <> v_upstream_b_id then
    raise exception 'changed upstream winner did not persist: %', v_result;
  end if;

  if (v_result ->> 'cleared')::integer <> 2 then
    raise exception 'expected recursive cleanup of semifinal and final: %', v_result;
  end if;

  select m.score_a, m.score_b, m.winner_team_id
  into v_score_a, v_score_b, v_winner_id
  from public.match m
  where m.id = v_later_id;

  if v_score_a is not null or v_score_b is not null or v_winner_id is not null then
    raise exception 'downstream match result was not cleared';
  end if;

  select count(*)::integer
  into v_count
  from public.match_map mm
  where mm.match_id = v_later_id;

  if v_count <> 0 then
    raise exception 'downstream match_map rows were not cleared: % remain', v_count;
  end if;

  select m.score_a, m.score_b, m.winner_team_id
  into v_score_a, v_score_b, v_winner_id
  from public.match m
  where m.id = v_final_id;

  select t.champion_name
  into v_champion_name
  from public.tournament t
  where t.id = v_tournament_id;

  if v_score_a is not null
    or v_score_b is not null
    or v_winner_id is not null
    or v_champion_name is not null
  then
    raise exception 'recursive invalidation did not clear final and champion';
  end if;
end
$test$;

rollback;

\echo 'match operations tests passed'
