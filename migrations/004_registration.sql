create or replace function public.submit_team(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug     text := payload ->> 'slug';
  v_name     text := btrim(payload ->> 'name');
  v_tag      text := upper(btrim(payload ->> 'tag'));
  v_captain  text := btrim(payload ->> 'captain');
  v_contact  text := btrim(payload ->> 'contact');
  v_dept     text := nullif(btrim(coalesce(payload ->> 'dept', '')), '');
  v_note     text := nullif(btrim(coalesce(payload ->> 'note', '')), '');
  v_players  jsonb := coalesce(payload -> 'players', '[]'::jsonb);
  v_tournament public.tournament%rowtype;
  v_taken    integer;
  v_team_id  bigint;
  v_player   jsonb;
  v_index    integer := 0;
begin
  if v_name = '' or v_tag = '' or v_captain = '' or v_contact = '' then
    return jsonb_build_object('ok', false, 'error', '请填写完整的必填项');
  end if;

  if char_length(v_tag) < 2 or char_length(v_tag) > 5 then
    return jsonb_build_object('ok', false, 'error', '战队 TAG 需要 2 到 5 个字符');
  end if;

  select * into v_tournament from public.tournament where slug = v_slug;
  if not found then
    return jsonb_build_object('ok', false, 'error', '赛事不存在');
  end if;

  perform pg_advisory_xact_lock(hashtext('submit_team'), v_tournament.id::integer);

  if v_tournament.status not in ('registration', 'postponed') then
    return jsonb_build_object('ok', false, 'error', '当前赛事未开放报名');
  end if;

  select count(*) into v_taken
  from public.team
  where tournament_id = v_tournament.id and status <> 'rejected';

  if v_taken >= v_tournament.team_cap then
    return jsonb_build_object('ok', false, 'error', '席位已满');
  end if;

  if exists (
    select 1 from public.team
    where tournament_id = v_tournament.id and (lower(name) = lower(v_name) or upper(tag) = v_tag)
  ) then
    return jsonb_build_object('ok', false, 'error', '战队名称或 TAG 已被占用');
  end if;

  insert into public.team (tournament_id, name, tag, captain, contact, dept, note, status)
  values (v_tournament.id, v_name, v_tag, v_captain, v_contact, v_dept, v_note, 'pending')
  returning id into v_team_id;

  for v_player in select * from jsonb_array_elements(v_players)
  loop
    v_index := v_index + 1;
    if nullif(btrim(v_player ->> 'nickname'), '') is not null then
      insert into public.player (team_id, nickname, role, is_substitute, sort_order)
      values (
        v_team_id,
        btrim(v_player ->> 'nickname'),
        nullif(btrim(coalesce(v_player ->> 'role', '')), ''),
        coalesce((v_player ->> 'substitute')::boolean, false),
        v_index
      );
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seatsLeft', v_tournament.team_cap - v_taken - 1);
end;
$$;

create or replace function public.registration_status(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cap', t.team_cap,
    'taken', (select count(*) from public.team where tournament_id = t.id and status <> 'rejected'),
    'open', t.status in ('registration', 'postponed')
  )
  from public.tournament t
  where t.slug = p_slug;
$$;

revoke all on function public.submit_team(jsonb) from public;
revoke all on function public.registration_status(text) from public;
grant execute on function public.submit_team(jsonb) to anon, authenticated;
grant execute on function public.registration_status(text) to anon, authenticated;
