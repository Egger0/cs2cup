drop policy if exists match_read on public.match;
create policy match_read on public.match for select using (
  exists (
    select 1
    from public.tournament t
    where t.id = tournament_id
      and t.status <> 'draft'
  )
);


create or replace function public.replace_match_schedule(
  p_tournament_id bigint,
  p_match_ids bigint[],
  p_expected_scheduled_at timestamptz[],
  p_scheduled_at timestamptz[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_tournament_id bigint;
  v_match_ids             bigint[];
  v_expected_scheduled_at timestamptz[];
  v_scheduled_at          timestamptz[];
  v_current_match_ids     bigint[];
  v_input_match_ids       bigint[];
  v_match_count           integer;
  v_distinct_match_count  integer;
  v_null_match_count      integer;
  v_scheduled_count       integer;
  v_cleared_count         integer;
  v_updated_count         integer;
begin
  select t.id
  into v_locked_tournament_id
  from public.tournament t
  where t.id = p_tournament_id;

  if not found then
    raise exception 'Tournament does not exist' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('match_operations:' || p_tournament_id::text, 0)
  );

  select t.id
  into v_locked_tournament_id
  from public.tournament t
  where t.id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament does not exist' using errcode = 'P0002';
  end if;

  perform 1
  from public.match m
  where m.tournament_id = p_tournament_id
  order by m.id
  for update;

  select coalesce(array_agg(entry.match_id order by entry.ordinality), array[]::bigint[])
  into v_match_ids
  from unnest(coalesce(p_match_ids, array[]::bigint[])) with ordinality
    as entry(match_id, ordinality);

  select coalesce(
    array_agg(entry.scheduled_at order by entry.ordinality),
    array[]::timestamptz[]
  )
  into v_expected_scheduled_at
  from unnest(coalesce(p_expected_scheduled_at, array[]::timestamptz[])) with ordinality
    as entry(scheduled_at, ordinality);

  select coalesce(
    array_agg(entry.scheduled_at order by entry.ordinality),
    array[]::timestamptz[]
  )
  into v_scheduled_at
  from unnest(coalesce(p_scheduled_at, array[]::timestamptz[])) with ordinality
    as entry(scheduled_at, ordinality);

  v_match_count := cardinality(v_match_ids);

  if v_match_count = 0 then
    raise exception 'Schedule must contain at least one match' using errcode = '22023';
  end if;

  if cardinality(v_expected_scheduled_at) <> v_match_count
    or cardinality(v_scheduled_at) <> v_match_count
  then
    raise exception 'Schedule arrays must have equal lengths' using errcode = '22023';
  end if;

  select
    count(distinct entry.match_id)::integer,
    count(*) filter (where entry.match_id is null)::integer
  into v_distinct_match_count, v_null_match_count
  from unnest(v_match_ids) as entry(match_id);

  if v_null_match_count > 0 or v_distinct_match_count <> v_match_count then
    raise exception 'Schedule match IDs must be non-null and unique' using errcode = '22023';
  end if;

  select coalesce(array_agg(entry.match_id order by entry.match_id), array[]::bigint[])
  into v_input_match_ids
  from unnest(v_match_ids) as entry(match_id);

  select coalesce(array_agg(m.id order by m.id), array[]::bigint[])
  into v_current_match_ids
  from public.match m
  where m.tournament_id = p_tournament_id
    and not (
      m.round = 0
      and m.source_match_a_id is null
      and m.source_match_b_id is null
      and m.winner_team_id is not null
      and m.score_a is null
      and m.score_b is null
      and ((m.team_a_id is null) <> (m.team_b_id is null))
    );

  if v_input_match_ids <> v_current_match_ids then
    raise exception 'Schedule no longer matches the current bracket; refresh and retry'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.match child
    left join public.match source_a on source_a.id = child.source_match_a_id
    left join public.match source_b on source_b.id = child.source_match_b_id
    where child.tournament_id = p_tournament_id
      and (
        child.source_match_a_id is not null
          and source_a.tournament_id is distinct from p_tournament_id
        or child.source_match_b_id is not null
          and source_b.tournament_id is distinct from p_tournament_id
      )
  ) then
    raise exception 'Schedule bracket contains an external source match'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.match m
    join unnest(v_match_ids, v_expected_scheduled_at)
      as expected(match_id, scheduled_at)
      on expected.match_id = m.id
    where m.tournament_id = p_tournament_id
      and m.scheduled_at is distinct from expected.scheduled_at
  ) then
    raise exception 'Schedule changed since it was loaded; refresh and retry'
      using errcode = '40001';
  end if;

  if exists (
    with proposed as (
      select entry.match_id, entry.scheduled_at
      from unnest(v_match_ids, v_scheduled_at)
        as entry(match_id, scheduled_at)
    )
    select 1
    from public.match child
    join proposed child_schedule on child_schedule.match_id = child.id
    join public.match parent
      on parent.id = child.source_match_a_id
      or parent.id = child.source_match_b_id
    join proposed parent_schedule on parent_schedule.match_id = parent.id
    where child.tournament_id = p_tournament_id
      and parent.tournament_id = p_tournament_id
      and child_schedule.scheduled_at is not null
      and parent_schedule.scheduled_at is not null
      and child_schedule.scheduled_at <= parent_schedule.scheduled_at
  ) then
    raise exception 'A downstream match must be scheduled after each scheduled source match'
      using errcode = '22023';
  end if;

  update public.match m
  set scheduled_at = null
  where m.tournament_id = p_tournament_id
    and m.round = 0
    and m.source_match_a_id is null
    and m.source_match_b_id is null
    and m.winner_team_id is not null
    and m.score_a is null
    and m.score_b is null
    and ((m.team_a_id is null) <> (m.team_b_id is null))
    and m.scheduled_at is not null;

  update public.match m
  set scheduled_at = proposed.scheduled_at
  from unnest(v_match_ids, v_scheduled_at)
    as proposed(match_id, scheduled_at)
  where m.id = proposed.match_id
    and m.tournament_id = p_tournament_id;

  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_match_count then
    raise exception 'Schedule no longer matches the current bracket; refresh and retry'
      using errcode = '40001';
  end if;

  select
    count(*) filter (where entry.scheduled_at is not null)::integer,
    count(*) filter (where entry.scheduled_at is null)::integer
  into v_scheduled_count, v_cleared_count
  from unnest(v_scheduled_at) as entry(scheduled_at);

  return jsonb_build_object(
    'ok', true,
    'matches', v_match_count,
    'scheduled', v_scheduled_count,
    'cleared', v_cleared_count
  );
end;
$$;


revoke execute on function public.replace_match_schedule(
  bigint,
  bigint[],
  timestamptz[],
  timestamptz[]
) from public, anon, authenticated;

notify pgrst, 'reload schema';
