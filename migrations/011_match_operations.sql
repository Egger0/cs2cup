create or replace function public.set_team_seed(
  p_tournament_id bigint,
  p_team_id bigint,
  p_seed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status         text;
  v_old_seed       integer;
  v_approved_count integer;
  v_conflict_id    bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('match_operations:' || p_tournament_id::text, 0)
  );

  if not exists (
    select 1
    from public.tournament t
    where t.id = p_tournament_id
  ) then
    raise exception '赛事不存在' using errcode = 'P0002';
  end if;

  perform 1
  from public.team t
  where t.tournament_id = p_tournament_id
  order by t.id
  for update;

  select t.status, t.seed
  into v_status, v_old_seed
  from public.team t
  where t.id = p_team_id
    and t.tournament_id = p_tournament_id;

  if not found then
    raise exception '战队不存在' using errcode = 'P0002';
  end if;

  if p_seed is null then
    update public.team
    set seed = null
    where id = p_team_id;

    return jsonb_build_object(
      'ok', true,
      'tournamentId', p_tournament_id,
      'teamId', p_team_id,
      'seed', null,
      'swappedTeamId', null
    );
  end if;

  if v_status <> 'approved' then
    raise exception '只有通过审核的战队可以设置种子' using errcode = '22023';
  end if;

  select count(*)::integer
  into v_approved_count
  from public.team t
  where t.tournament_id = p_tournament_id
    and t.status = 'approved';

  if p_seed < 1 or p_seed > v_approved_count then
    raise exception '种子号需要在 1–% 之间', v_approved_count using errcode = '22023';
  end if;

  select t.id
  into v_conflict_id
  from public.team t
  where t.tournament_id = p_tournament_id
    and t.status = 'approved'
    and t.id <> p_team_id
    and t.seed = p_seed
  order by t.id
  limit 1;

  if v_conflict_id is not null then
    update public.team
    set seed = v_old_seed
    where id = v_conflict_id;
  end if;

  update public.team
  set seed = p_seed
  where id = p_team_id;

  return jsonb_build_object(
    'ok', true,
    'tournamentId', p_tournament_id,
    'teamId', p_team_id,
    'seed', p_seed,
    'swappedTeamId', v_conflict_id
  );
end;
$$;


create or replace function public.replace_bracket(
  p_tournament_id bigint,
  p_team_ids bigint[],
  p_seed_positions integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_ids       bigint[];
  v_seed_positions integer[];
  v_approved_ids   bigint[];
  v_input_ids      bigint[];
  v_team_cap       integer;
  v_team_count     integer;
  v_distinct_teams integer;
  v_size           integer;
  v_expected_size  integer := 2;
  v_position_count integer;
  v_position_min   integer;
  v_position_max   integer;
  v_round          integer := 0;
  v_match_count    integer;
  v_round_label    text;
  v_best_of        integer;
  v_inserted       integer;
  v_created        integer := 0;
  v_byes           integer := 0;
begin
  select t.team_cap
  into v_team_cap
  from public.tournament t
  where t.id = p_tournament_id;

  if not found then
    raise exception '赛事不存在' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('match_operations:' || p_tournament_id::text, 0)
  );

  select t.team_cap
  into v_team_cap
  from public.tournament t
  where t.id = p_tournament_id
  for update;

  if not found then
    raise exception '赛事不存在' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(entry.team_id order by entry.ordinality), array[]::bigint[])
  into v_team_ids
  from unnest(coalesce(p_team_ids, array[]::bigint[])) with ordinality
    as entry(team_id, ordinality);

  select coalesce(array_agg(entry.seed_position order by entry.ordinality), array[]::integer[])
  into v_seed_positions
  from unnest(coalesce(p_seed_positions, array[]::integer[])) with ordinality
    as entry(seed_position, ordinality);

  v_team_count := cardinality(v_team_ids);
  v_size := cardinality(v_seed_positions);

  if v_team_count < 2 then
    raise exception '至少需要两支已通过审核的战队' using errcode = '22023';
  end if;

  if v_team_count > v_team_cap then
    raise exception '已通过审核的战队数超过赛事席位上限' using errcode = '22023';
  end if;

  perform 1
  from public.team t
  where t.tournament_id = p_tournament_id
  for update;

  select
    coalesce(array_agg(t.id order by t.id), array[]::bigint[])
  into v_approved_ids
  from public.team t
  where t.tournament_id = p_tournament_id
    and t.status = 'approved';

  select
    coalesce(array_agg(entry.team_id order by entry.team_id), array[]::bigint[]),
    count(distinct entry.team_id)::integer
  into v_input_ids, v_distinct_teams
  from unnest(v_team_ids) as entry(team_id);

  if v_distinct_teams <> v_team_count or v_input_ids <> v_approved_ids then
    raise exception '传入战队必须与赛事全部已通过审核的战队完全一致'
      using errcode = '22023';
  end if;

  while v_expected_size < v_team_count loop
    v_expected_size := v_expected_size * 2;
  end loop;

  if v_size <> v_expected_size then
    raise exception '签表位置数必须是容纳全部战队的最小 2 次幂（期望 %，实际 %）',
      v_expected_size, v_size
      using errcode = '22023';
  end if;

  select
    count(distinct entry.seed_position)::integer,
    min(entry.seed_position),
    max(entry.seed_position)
  into v_position_count, v_position_min, v_position_max
  from unnest(v_seed_positions) as entry(seed_position);

  if v_position_count <> v_size
    or v_position_min <> 1
    or v_position_max <> v_size
  then
    raise exception '签表位置必须是 1 到 % 的完整排列', v_size
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from (
      select
        ((entry.ordinality - 1) / 2)::integer as match_slot,
        count(*) filter (where entry.seed_number <= v_team_count) as occupied
      from unnest(v_seed_positions) with ordinality
        as entry(seed_number, ordinality)
      group by ((entry.ordinality - 1) / 2)::integer
    ) as first_round
    where first_round.occupied = 0
  ) then
    raise exception '签位排列产生了双方均为空的首轮比赛' using errcode = '22023';
  end if;

  update public.team
  set seed = null
  where tournament_id = p_tournament_id
    and seed is not null;

  update public.team t
  set seed = seeded.seed_number::integer
  from unnest(v_team_ids) with ordinality as seeded(team_id, seed_number)
  where t.id = seeded.team_id;

  update public.tournament
  set champion_name = null
  where id = p_tournament_id;

  delete from public.match
  where tournament_id = p_tournament_id;

  v_match_count := v_size / 2;
  while v_match_count >= 1 loop
    v_round_label := case v_match_count
      when 1 then '总决赛'
      when 2 then '半决赛'
      when 4 then '八强'
      when 8 then '16 强'
      when 16 then '32 强'
      else format('第 %s 轮', v_round + 1)
    end;
    v_best_of := case when v_match_count = 1 then 5 else 3 end;

    insert into public.match (
      tournament_id,
      round,
      slot,
      round_label,
      best_of
    )
    select
      p_tournament_id,
      v_round,
      slots.slot_number,
      v_round_label,
      v_best_of
    from generate_series(0, v_match_count - 1) as slots(slot_number);

    get diagnostics v_inserted = row_count;
    v_created := v_created + v_inserted;
    v_round := v_round + 1;
    v_match_count := v_match_count / 2;
  end loop;

  update public.match target
  set
    source_match_a_id = source_a.id,
    source_match_b_id = source_b.id
  from public.match source_a, public.match source_b
  where target.tournament_id = p_tournament_id
    and target.round > 0
    and source_a.tournament_id = target.tournament_id
    and source_a.round = target.round - 1
    and source_a.slot = target.slot * 2
    and source_b.tournament_id = target.tournament_id
    and source_b.round = target.round - 1
    and source_b.slot = target.slot * 2 + 1;

  with slot_teams as (
    select
      ((entry.ordinality - 1) / 2)::integer as match_slot,
      ((entry.ordinality - 1) % 2)::integer as side,
      case
        when entry.seed_number <= v_team_count then v_team_ids[entry.seed_number]
        else null
      end as team_id
    from unnest(v_seed_positions) with ordinality
      as entry(seed_number, ordinality)
  ), first_round as (
    select
      match_slot,
      max(team_id) filter (where side = 0) as team_a_id,
      max(team_id) filter (where side = 1) as team_b_id
    from slot_teams
    group by match_slot
  )
  update public.match target
  set
    team_a_id = first_round.team_a_id,
    team_b_id = first_round.team_b_id
  from first_round
  where target.tournament_id = p_tournament_id
    and target.round = 0
    and target.slot = first_round.match_slot;

  update public.match
  set winner_team_id = coalesce(team_a_id, team_b_id)
  where tournament_id = p_tournament_id
    and round = 0
    and ((team_a_id is null) <> (team_b_id is null));

  get diagnostics v_byes = row_count;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'byes', v_byes,
    'teams', v_team_count
  );
end;
$$;


drop function if exists public.save_match_report(bigint, jsonb);
drop function if exists public.save_match_score(bigint, integer, integer);


create or replace function public.save_match_score(
  p_match_id bigint,
  p_team_a_id bigint,
  p_team_b_id bigint,
  p_score_a integer,
  p_score_b integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id  bigint;
  v_locked_tournament_id bigint;
  v_round           integer;
  v_best_of         integer;
  v_team_a_id       bigint;
  v_team_b_id       bigint;
  v_direct_a_id     bigint;
  v_direct_b_id     bigint;
  v_source_a_id     bigint;
  v_source_b_id     bigint;
  v_old_winner_id   bigint;
  v_winner_id       bigint;
  v_wins_needed     integer;
  v_is_first_round_bye boolean;
  v_downstream_ids  bigint[] := array[]::bigint[];
  v_cleared         integer := 0;
  v_final_match_id  bigint;
  v_champion_name   text;
begin
  select m.tournament_id
  into v_tournament_id
  from public.match m
  where m.id = p_match_id;

  if not found then
    raise exception '比赛不存在' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('match_operations:' || v_tournament_id::text, 0)
  );

  select
    m.tournament_id,
    m.round,
    m.best_of,
    m.team_a_id,
    m.team_b_id,
    m.source_match_a_id,
    m.source_match_b_id,
    coalesce(m.team_a_id, source_a.winner_team_id),
    coalesce(m.team_b_id, source_b.winner_team_id),
    m.winner_team_id
  into
    v_locked_tournament_id,
    v_round,
    v_best_of,
    v_direct_a_id,
    v_direct_b_id,
    v_source_a_id,
    v_source_b_id,
    v_team_a_id,
    v_team_b_id,
    v_old_winner_id
  from public.match m
  left join public.match source_a on source_a.id = m.source_match_a_id
  left join public.match source_b on source_b.id = m.source_match_b_id
  where m.id = p_match_id
  for update of m;

  if not found then
    raise exception '比赛不存在' using errcode = 'P0002';
  end if;

  if v_locked_tournament_id <> v_tournament_id then
    raise exception '比赛所属赛事在操作期间发生变化，请重试' using errcode = '40001';
  end if;

  if v_team_a_id is distinct from p_team_a_id
    or v_team_b_id is distinct from p_team_b_id
  then
    raise exception '对阵双方已变化，请刷新页面后重试' using errcode = '40001';
  end if;

  if (p_score_a is null) <> (p_score_b is null) then
    raise exception '双方比分必须同时填写或同时清空' using errcode = '22023';
  end if;

  v_is_first_round_bye := v_round = 0
    and v_source_a_id is null
    and v_source_b_id is null
    and ((v_direct_a_id is null) <> (v_direct_b_id is null));

  if p_score_a is null then
    v_winner_id := case
      when v_is_first_round_bye then coalesce(v_direct_a_id, v_direct_b_id)
      else null
    end;
  else
    if v_team_a_id is null or v_team_b_id is null then
      raise exception '对阵双方尚未确定，不能录入比分' using errcode = '22023';
    end if;

    if v_team_a_id = v_team_b_id then
      raise exception '对阵双方不能是同一支战队' using errcode = '22023';
    end if;

    if p_score_a < 0 or p_score_b < 0 then
      raise exception '比分不能为负数' using errcode = '22023';
    end if;

    v_wins_needed := (v_best_of / 2) + 1;
    if p_score_a > v_wins_needed or p_score_b > v_wins_needed then
      raise exception 'BO% 单方最多取得 % 个地图胜场', v_best_of, v_wins_needed
        using errcode = '22023';
    end if;

    if p_score_a = v_wins_needed and p_score_b = v_wins_needed then
      raise exception '系列赛不能由双方同时获胜' using errcode = '22023';
    end if;

    v_winner_id := case
      when p_score_a = v_wins_needed and p_score_a > p_score_b then v_team_a_id
      when p_score_b = v_wins_needed and p_score_b > p_score_a then v_team_b_id
      else null
    end;
  end if;

  if exists (
    select 1
    from public.match_map mm
    where mm.match_id = p_match_id
  ) then
    raise exception '本场已有逐图战报，请在战报编辑器中修改比分'
      using errcode = '22023';
  end if;

  update public.match
  set
    score_a = p_score_a,
    score_b = p_score_b,
    winner_team_id = v_winner_id
  where id = p_match_id;

  if v_old_winner_id is distinct from v_winner_id then
    with recursive downstream(id) as (
      select child.id
      from public.match child
      where child.tournament_id = v_tournament_id
        and (child.source_match_a_id = p_match_id or child.source_match_b_id = p_match_id)

      union

      select child.id
      from public.match child
      join downstream parent
        on child.source_match_a_id = parent.id
        or child.source_match_b_id = parent.id
      where child.tournament_id = v_tournament_id
    )
    select coalesce(array_agg(id), array[]::bigint[])
    into v_downstream_ids
    from downstream;

    delete from public.match_map
    where match_id = any(v_downstream_ids);

    update public.match
    set
      score_a = null,
      score_b = null,
      winner_team_id = null
    where id = any(v_downstream_ids);

    v_cleared := cardinality(v_downstream_ids);
  end if;

  select final_match.id
  into v_final_match_id
  from public.match final_match
  where final_match.tournament_id = v_tournament_id
  order by final_match.round desc, final_match.slot asc
  limit 1;

  if v_final_match_id is not null
    and (
      p_match_id = v_final_match_id
      or v_final_match_id = any(v_downstream_ids)
    )
  then
    select winner.name
    into v_champion_name
    from public.match final_match
    left join public.team winner on winner.id = final_match.winner_team_id
    where final_match.id = v_final_match_id;

    update public.tournament
    set champion_name = v_champion_name
    where id = v_tournament_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tournamentId', v_tournament_id,
    'matchId', p_match_id,
    'scoreA', p_score_a,
    'scoreB', p_score_b,
    'winnerTeamId', v_winner_id,
    'cleared', v_cleared
  );
end;
$$;


create or replace function public.save_match_report(
  p_match_id bigint,
  p_team_a_id bigint,
  p_team_b_id bigint,
  p_maps jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id bigint;
  v_locked_tournament_id bigint;
  v_best_of        integer;
  v_map_pool       jsonb;
  v_team_a_id      bigint;
  v_team_b_id      bigint;
  v_maps           jsonb := coalesce(p_maps, '[]'::jsonb);
  v_map_count      integer;
  v_pool_count     integer;
  v_pick_order     integer;
  v_entry          jsonb;
  v_map_name       text;
  v_action         text;
  v_chosen_by      text;
  v_played         boolean;
  v_score_a        integer;
  v_score_b        integer;
  v_played_count   integer := 0;
  v_series_a       integer := 0;
  v_series_b       integer := 0;
  v_wins_needed    integer;
  v_deciders       integer := 0;
  v_seen_maps      text[] := array[]::text[];
  v_result         jsonb;
begin
  if jsonb_typeof(v_maps) <> 'array' then
    raise exception '地图战报必须是数组' using errcode = '22023';
  end if;

  select m.tournament_id
  into v_tournament_id
  from public.match m
  where m.id = p_match_id;

  if not found then
    raise exception '比赛不存在' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('match_operations:' || v_tournament_id::text, 0)
  );

  select
    m.tournament_id,
    m.best_of,
    t.map_pool,
    coalesce(m.team_a_id, source_a.winner_team_id),
    coalesce(m.team_b_id, source_b.winner_team_id)
  into
    v_locked_tournament_id,
    v_best_of,
    v_map_pool,
    v_team_a_id,
    v_team_b_id
  from public.match m
  join public.tournament t on t.id = m.tournament_id
  left join public.match source_a on source_a.id = m.source_match_a_id
  left join public.match source_b on source_b.id = m.source_match_b_id
  where m.id = p_match_id
  for update of m;

  if not found then
    raise exception '比赛不存在' using errcode = 'P0002';
  end if;

  if v_locked_tournament_id <> v_tournament_id then
    raise exception '比赛所属赛事在操作期间发生变化，请重试' using errcode = '40001';
  end if;

  if v_team_a_id is null or v_team_b_id is null then
    raise exception '对阵双方尚未确定，不能录入地图战报' using errcode = '22023';
  end if;

  if v_team_a_id is distinct from p_team_a_id
    or v_team_b_id is distinct from p_team_b_id
  then
    raise exception '对阵双方已变化，请刷新页面后重试' using errcode = '40001';
  end if;

  if jsonb_typeof(v_map_pool) <> 'array' then
    raise exception '赛事地图池配置无效' using errcode = '22023';
  end if;

  v_map_count := jsonb_array_length(v_maps);
  v_pool_count := jsonb_array_length(v_map_pool);
  v_wins_needed := (v_best_of / 2) + 1;

  if v_map_count > v_pool_count then
    raise exception '战报地图数量不能超过赛事地图池' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_maps) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception '每条地图记录必须是对象' using errcode = '22023';
  end if;

  for v_entry, v_pick_order in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(v_maps) with ordinality as item(value, ordinality)
    order by item.ordinality
  loop
    if jsonb_typeof(v_entry -> 'mapName') is distinct from 'string'
      or jsonb_typeof(v_entry -> 'action') is distinct from 'string'
      or jsonb_typeof(v_entry -> 'played') is distinct from 'boolean'
    then
      raise exception '地图名称、动作和进行状态格式无效' using errcode = '22023';
    end if;

    v_map_name := btrim(v_entry ->> 'mapName');
    v_action := v_entry ->> 'action';
    v_chosen_by := case
      when v_entry -> 'chosenBy' is null or jsonb_typeof(v_entry -> 'chosenBy') = 'null' then null
      when jsonb_typeof(v_entry -> 'chosenBy') = 'string' then nullif(v_entry ->> 'chosenBy', '')
      else '__invalid__'
    end;
    v_played := (v_entry ->> 'played')::boolean;

    v_score_a := case
      when v_entry -> 'scoreA' is null or jsonb_typeof(v_entry -> 'scoreA') = 'null' then null
      when jsonb_typeof(v_entry -> 'scoreA') = 'number' then (v_entry ->> 'scoreA')::integer
      else -1
    end;
    v_score_b := case
      when v_entry -> 'scoreB' is null or jsonb_typeof(v_entry -> 'scoreB') = 'null' then null
      when jsonb_typeof(v_entry -> 'scoreB') = 'number' then (v_entry ->> 'scoreB')::integer
      else -1
    end;

    if v_map_name = '' then
      raise exception '地图名称不能为空' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from jsonb_array_elements_text(v_map_pool) as pool(map_name)
      where pool.map_name = v_map_name
    ) then
      raise exception '地图“%”不在赛事地图池中', v_map_name using errcode = '22023';
    end if;

    if lower(v_map_name) = any(v_seen_maps) then
      raise exception '同一张地图不能重复出现：%', v_map_name using errcode = '22023';
    end if;
    v_seen_maps := array_append(v_seen_maps, lower(v_map_name));

    if v_action not in ('ban', 'pick', 'decider') then
      raise exception '地图动作无效：%', v_action using errcode = '22023';
    end if;

    if v_action in ('ban', 'pick')
      and (v_chosen_by is null or v_chosen_by not in ('a', 'b'))
    then
      raise exception 'Ban/Pick 必须指定 A 方或 B 方' using errcode = '22023';
    end if;

    if v_action = 'decider' then
      v_deciders := v_deciders + 1;
      if v_chosen_by is not null then
        raise exception '决胜图不能指定选择方' using errcode = '22023';
      end if;
    end if;

    if v_deciders > 1 then
      raise exception '最多只能有一张决胜图' using errcode = '22023';
    end if;

    if v_action = 'ban' and (v_played or v_score_a is not null or v_score_b is not null) then
      raise exception '被禁用的地图不能标记为已进行或填写比分' using errcode = '22023';
    end if;

    if not v_played and (v_score_a is not null or v_score_b is not null) then
      raise exception '未进行的地图不能填写比分' using errcode = '22023';
    end if;

    if v_played then
      if v_action = 'ban' then
        raise exception '被禁用的地图不能进行比赛' using errcode = '22023';
      end if;

      if v_score_a is null or v_score_b is null then
        raise exception '已进行的地图必须填写双方比分' using errcode = '22023';
      end if;

      if v_score_a < 0 or v_score_b < 0 then
        raise exception '地图比分不能为负数' using errcode = '22023';
      end if;

      if v_score_a = v_score_b then
        raise exception '已进行的地图不能以平局结束' using errcode = '22023';
      end if;

      if v_series_a >= v_wins_needed or v_series_b >= v_wins_needed then
        raise exception '系列赛分出胜负后不能继续录入地图' using errcode = '22023';
      end if;

      v_played_count := v_played_count + 1;
      if v_score_a > v_score_b then
        v_series_a := v_series_a + 1;
      else
        v_series_b := v_series_b + 1;
      end if;
    end if;

  end loop;

  if v_played_count > v_best_of then
    raise exception 'BO% 最多进行 % 张地图', v_best_of, v_best_of using errcode = '22023';
  end if;

  delete from public.match_map
  where match_id = p_match_id;

  if v_played_count = 0 then
    v_result := public.save_match_score(
      p_match_id,
      p_team_a_id,
      p_team_b_id,
      null,
      null
    );
  else
    v_result := public.save_match_score(
      p_match_id,
      p_team_a_id,
      p_team_b_id,
      v_series_a,
      v_series_b
    );
  end if;

  insert into public.match_map (
    match_id,
    pick_order,
    map_name,
    action,
    chosen_by,
    score_a,
    score_b,
    played
  )
  select
    p_match_id,
    item.ordinality::integer,
    btrim(item.value ->> 'mapName'),
    item.value ->> 'action',
    case
      when item.value -> 'chosenBy' is null
        or jsonb_typeof(item.value -> 'chosenBy') = 'null'
      then null
      else nullif(item.value ->> 'chosenBy', '')
    end,
    case
      when item.value -> 'scoreA' is null
        or jsonb_typeof(item.value -> 'scoreA') = 'null'
      then null
      else (item.value ->> 'scoreA')::integer
    end,
    case
      when item.value -> 'scoreB' is null
        or jsonb_typeof(item.value -> 'scoreB') = 'null'
      then null
      else (item.value ->> 'scoreB')::integer
    end,
    (item.value ->> 'played')::boolean
  from jsonb_array_elements(v_maps) with ordinality as item(value, ordinality)
  order by item.ordinality;

  return v_result || jsonb_build_object('maps', v_map_count);
end;
$$;


revoke execute on function public.set_team_seed(bigint, bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.replace_bracket(bigint, bigint[], integer[])
  from public, anon, authenticated;
revoke execute on function public.save_match_score(bigint, bigint, bigint, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.save_match_report(bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
