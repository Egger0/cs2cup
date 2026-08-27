\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_function                regprocedure;
  v_security_definer        boolean;
  v_game_id                 bigint;
  v_tournament_id           bigint;
  v_other_tournament_id     bigint;
  v_other_match_id          bigint;
  v_team_ids                bigint[];
  v_match_ids               bigint[];
  v_old_match_ids           bigint[];
  v_expected                timestamptz[];
  v_desired                 timestamptz[];
  v_clear                    timestamptz[];
  v_actual                   timestamptz[];
  v_bad_ids                  bigint[];
  v_bad_expected             timestamptz[];
  v_bad_desired              timestamptz[];
  v_child_id                 bigint;
  v_parent_id                bigint;
  v_parent_time              timestamptz;
  v_result                   jsonb;
  v_count                    integer;
begin
  v_function := to_regprocedure(
    'public.replace_match_schedule(bigint,bigint[],timestamptz[],timestamptz[])'
  );

  if v_function is null then
    raise exception 'replace_match_schedule is missing';
  end if;

  select p.prosecdef
  into v_security_definer
  from pg_proc p
  where p.oid = v_function::oid;

  if v_security_definer is distinct from true then
    raise exception 'replace_match_schedule must be SECURITY DEFINER';
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

  insert into public.game (slug, name, sort_order, active)
  values (
    format('match-schedule-test-%s', txid_current()),
    'Match schedule test game',
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
    team_cap
  ) values (
    format('match-schedule-test-%s', txid_current()),
    'Atomic schedule test',
    v_game_id,
    '2099',
    1,
    'running',
    16
  )
  returning id into v_tournament_id;

  insert into public.tournament (
    slug,
    title,
    game_id,
    season,
    edition,
    status,
    team_cap
  ) values (
    format('match-schedule-other-%s', txid_current()),
    'Other schedule test',
    v_game_id,
    '2099',
    2,
    'running',
    2
  )
  returning id into v_other_tournament_id;

  insert into public.match (tournament_id, round, slot, round_label, best_of)
  values (v_other_tournament_id, 0, 0, 'Final', 3)
  returning id into v_other_match_id;

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
    format('Schedule Team %s', seed_number),
    format('SC%s', seed_number),
    format('Captain %s', seed_number),
    format('schedule-%s', seed_number),
    'approved'
  from generate_series(1, 6) as seeds(seed_number);

  select array_agg(t.id order by t.tag)
  into v_team_ids
  from public.team t
  where t.tournament_id = v_tournament_id;

  perform public.replace_bracket(
    v_tournament_id,
    v_team_ids,
    array[1, 8, 4, 5, 2, 7, 3, 6]
  );

  select
    array_agg(m.id order by m.id),
    array_agg(null::timestamptz order by m.id),
    array_agg(
      timestamptz '2099-04-01 10:00+08'
        + m.round * interval '1 day'
        + m.slot * interval '2 hours'
      order by m.id
    )
  into v_match_ids, v_expected, v_desired
  from public.match m
  where m.tournament_id = v_tournament_id
    and not (
      m.round = 0
      and m.source_match_a_id is null
      and m.source_match_b_id is null
      and m.winner_team_id is not null
      and m.score_a is null
      and m.score_b is null
      and ((m.team_a_id is null) <> (m.team_b_id is null))
    );

  if cardinality(v_match_ids) <> 5 then
    raise exception 'expected five schedulable matches, found %', cardinality(v_match_ids);
  end if;

  update public.match m
  set scheduled_at = timestamptz '2099-03-31 10:00+08'
  where m.tournament_id = v_tournament_id
    and m.round = 0
    and m.source_match_a_id is null
    and m.source_match_b_id is null
    and m.winner_team_id is not null
    and m.score_a is null
    and m.score_b is null
    and ((m.team_a_id is null) <> (m.team_b_id is null));

  if not found then
    raise exception 'expected at least one bye to exercise cleanup';
  end if;

  v_result := public.replace_match_schedule(
    v_tournament_id,
    v_match_ids,
    v_expected,
    v_desired
  );

  if v_result ->> 'ok' <> 'true'
    or (v_result ->> 'matches')::integer <> 5
    or (v_result ->> 'scheduled')::integer <> 5
    or (v_result ->> 'cleared')::integer <> 0
  then
    raise exception 'unexpected schedule result: %', v_result;
  end if;

  select array_agg(m.scheduled_at order by input.ordinality)
  into v_actual
  from unnest(v_match_ids) with ordinality as input(match_id, ordinality)
  join public.match m on m.id = input.match_id;

  if v_actual is distinct from v_desired then
    raise exception 'valid schedule did not persist atomically: %', v_actual;
  end if;

  if exists (
    select 1
    from public.match m
    where m.tournament_id = v_tournament_id
      and m.round = 0
      and m.source_match_a_id is null
      and m.source_match_b_id is null
      and m.winner_team_id is not null
      and m.score_a is null
      and m.score_b is null
      and ((m.team_a_id is null) <> (m.team_b_id is null))
      and m.scheduled_at is not null
  ) then
    raise exception 'valid schedule did not clear bye timestamps';
  end if;

  v_desired[1] := v_desired[1] + interval '0.123456 seconds';
  update public.match
  set scheduled_at = v_desired[1]
  where id = v_match_ids[1];

  v_result := public.replace_match_schedule(
    v_tournament_id,
    v_match_ids,
    v_desired,
    v_desired
  );

  if (v_result ->> 'scheduled')::integer <> 5 then
    raise exception 'refreshed schedule replay failed: %', v_result;
  end if;

  select array_agg(null::timestamptz order by input.ordinality)
  into v_clear
  from unnest(v_match_ids) with ordinality as input(match_id, ordinality);

  v_result := public.replace_match_schedule(
    v_tournament_id,
    v_match_ids,
    v_desired,
    v_clear
  );

  if (v_result ->> 'matches')::integer <> 5
    or (v_result ->> 'scheduled')::integer <> 0
    or (v_result ->> 'cleared')::integer <> 5
  then
    raise exception 'unexpected clear result: %', v_result;
  end if;

  select count(*)::integer
  into v_count
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.scheduled_at is not null;

  if v_count <> 0 then
    raise exception 'schedule clear left % timestamps', v_count;
  end if;

  perform public.replace_match_schedule(
    v_tournament_id,
    v_match_ids,
    v_clear,
    v_desired
  );

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      array[]::bigint[],
      array[]::timestamptz[],
      array[]::timestamptz[]
    );
    raise exception 'replace_match_schedule accepted an empty schedule';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_match_ids,
      v_desired[1:cardinality(v_desired) - 1],
      v_desired
    );
    raise exception 'replace_match_schedule accepted unequal array lengths';
  exception
    when sqlstate '22023' then null;
  end;

  v_bad_ids := v_match_ids;
  v_bad_ids[2] := v_bad_ids[1];
  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_bad_ids,
      v_desired,
      v_desired
    );
    raise exception 'replace_match_schedule accepted duplicate match IDs';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_match_ids[1:cardinality(v_match_ids) - 1],
      v_desired[1:cardinality(v_desired) - 1],
      v_desired[1:cardinality(v_desired) - 1]
    );
    raise exception 'replace_match_schedule accepted an incomplete match set';
  exception
    when sqlstate '40001' then null;
  end;

  v_bad_ids := v_match_ids;
  v_bad_ids[cardinality(v_bad_ids)] := v_other_match_id;
  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_bad_ids,
      v_desired,
      v_desired
    );
    raise exception 'replace_match_schedule accepted a cross-tournament match';
  exception
    when sqlstate '40001' then null;
  end;

  v_bad_expected := v_desired;
  v_bad_expected[1] := v_bad_expected[1] + interval '1 minute';
  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_match_ids,
      v_bad_expected,
      v_desired
    );
    raise exception 'replace_match_schedule accepted stale expected timestamps';
  exception
    when sqlstate '40001' then null;
  end;

  select final_match.id, final_match.source_match_a_id
  into v_child_id, v_parent_id
  from public.match final_match
  where final_match.tournament_id = v_tournament_id
  order by final_match.round desc, final_match.slot
  limit 1;

  update public.match
  set source_match_a_id = v_other_match_id
  where id = v_child_id;

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_match_ids,
      v_desired,
      v_desired
    );
    raise exception 'replace_match_schedule accepted an external source match';
  exception
    when sqlstate '40001' then null;
  end;

  update public.match
  set source_match_a_id = v_parent_id
  where id = v_child_id;

  select input.scheduled_at
  into v_parent_time
  from unnest(v_match_ids, v_desired) as input(match_id, scheduled_at)
  where input.match_id = v_parent_id;

  select array_agg(
    case when input.match_id = v_child_id then v_parent_time else input.scheduled_at end
    order by input.ordinality
  )
  into v_bad_desired
  from unnest(v_match_ids, v_desired) with ordinality
    as input(match_id, scheduled_at, ordinality);

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_match_ids,
      v_desired,
      v_bad_desired
    );
    raise exception 'replace_match_schedule accepted a non-chronological bracket';
  exception
    when sqlstate '22023' then null;
  end;

  select array_agg(m.scheduled_at order by input.ordinality)
  into v_actual
  from unnest(v_match_ids) with ordinality as input(match_id, ordinality)
  join public.match m on m.id = input.match_id;

  if v_actual is distinct from v_desired then
    raise exception 'a rejected schedule changed persisted timestamps: %', v_actual;
  end if;

  v_old_match_ids := v_match_ids;

  perform public.replace_bracket(
    v_tournament_id,
    v_team_ids,
    array[1, 8, 4, 5, 2, 7, 3, 6]
  );

  begin
    perform public.replace_match_schedule(
      v_tournament_id,
      v_old_match_ids,
      v_desired,
      v_desired
    );
    raise exception 'replace_match_schedule accepted IDs from a stale bracket';
  exception
    when sqlstate '40001' then null;
  end;

  select count(*)::integer
  into v_count
  from public.match m
  where m.tournament_id = v_tournament_id
    and m.scheduled_at is not null;

  if v_count <> 0 then
    raise exception 'stale bracket rejection changed the replacement bracket';
  end if;
end
$test$;

with draft_tournament as (
  insert into public.tournament (
    slug,
    title,
    game_id,
    season,
    edition,
    status,
    team_cap
  ) values (
    format('draft-schedule-privacy-%s', txid_current()),
    'Draft schedule privacy test',
    (select id from public.game order by id limit 1),
    '2099',
    99,
    'draft',
    2
  )
  returning id
)
insert into public.match (tournament_id, round, slot, round_label, best_of, scheduled_at)
select id, 0, 0, format('Draft schedule privacy test %s', txid_current()), 3, now()
from draft_tournament;

set local role anon;

do $privacy$
begin
  if exists (
    select 1
    from public.match
    where round_label = format('Draft schedule privacy test %s', txid_current())
  ) then
    raise exception 'anon can read a draft tournament schedule';
  end if;

  if not exists (
    select 1
    from public.match
    where tournament_id = (
      select id
      from public.tournament
      where slug = format('match-schedule-test-%s', txid_current())
    )
  ) then
    raise exception 'anon cannot read a published tournament schedule';
  end if;
end
$privacy$;

reset role;

rollback;

\echo 'match schedule tests passed'
