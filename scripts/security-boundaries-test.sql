\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_role pg_roles%rowtype;
begin
  select * into v_role from pg_roles where rolname = 'club_admin';

  if not found then
    raise exception 'club_admin must exist in the local PostgreSQL stack';
  end if;

  if v_role.rolsuper
    or v_role.rolcreaterole
    or v_role.rolcreatedb
    or v_role.rolcanlogin
    or v_role.rolbypassrls
  then
    raise exception 'club_admin has an unsafe role attribute';
  end if;

  if has_table_privilege('anon', 'public.team', 'select')
    or has_table_privilege('anon', 'public.player', 'select')
    or has_table_privilege('anon', 'public.admin_user', 'select')
  then
    raise exception 'anon can select a private table';
  end if;

  if has_function_privilege('anon', 'public.submit_team(jsonb)', 'execute') then
    raise exception 'anon can bypass the server-side registration guard';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_public'
      and column_name in ('contact', 'note')
  ) then
    raise exception 'team_public exposes private registration fields';
  end if;
end
$test$;

insert into public.game (slug, name, active)
values ('security-boundaries-game', 'Security boundary test', true)
returning id as boundary_game_id \gset

insert into public.tournament (
  slug, title, game_id, season, edition, status, team_cap
)
values (
  'security-boundaries-draft', 'Draft boundary test', :'boundary_game_id',
  'test', 9001, 'draft', 8
)
returning id as draft_tournament_id \gset

insert into public.tournament (
  slug, title, game_id, season, edition, status, team_cap
)
values (
  'security-boundaries-public', 'Public boundary test', :'boundary_game_id',
  'test', 9002, 'registration', 8
)
returning id as public_tournament_id \gset

insert into public.team (
  tournament_id, name, tag, captain, contact, note, status
)
values (
  :'draft_tournament_id', 'Draft Team', 'SBD', 'Draft Captain',
  'private-draft-contact', 'private draft note', 'approved'
)
returning id as draft_team_id \gset

insert into public.team (
  tournament_id, name, tag, captain, contact, note, status
)
values (
  :'public_tournament_id', 'Public Team', 'SBP', 'Public Captain',
  'private-public-contact', 'private public note', 'approved'
)
returning id as public_team_id \gset

insert into public.player (team_id, nickname, sort_order)
values (:'draft_team_id', 'Draft Player', 1);

insert into public.player (team_id, nickname, sort_order)
values (:'public_team_id', 'Public Player', 1);

insert into public.match (
  tournament_id, round, slot, round_label, team_a_id
)
values (:'draft_tournament_id', 1, 1, 'Draft round', :'draft_team_id')
returning id as draft_match_id \gset

insert into public.match (
  tournament_id, round, slot, round_label, team_a_id
)
values (:'public_tournament_id', 1, 1, 'Public round', :'public_team_id')
returning id as public_match_id \gset

insert into public.match_map (match_id, pick_order, map_name, action)
values (:'draft_match_id', 1, 'de_draft', 'decider');

insert into public.match_map (match_id, pick_order, map_name, action)
values (:'public_match_id', 1, 'de_public', 'decider');

insert into public.photo (tournament_id, storage_key, width, height, caption)
values (:'draft_tournament_id', 'security-boundaries/draft.webp', 1, 1, 'Draft photo');

insert into public.photo (tournament_id, storage_key, width, height, caption)
values (:'public_tournament_id', 'security-boundaries/public.webp', 1, 1, 'Public photo');

insert into public.post (slug, title, summary, body, published_at)
values (
  'security-boundaries-past', 'Published post', 'Published', 'Published',
  now() - interval '1 hour'
);

insert into public.post (slug, title, summary, body, published_at)
values (
  'security-boundaries-future', 'Future post', 'Future', 'Future',
  now() + interval '1 day'
);

set local role anon;

do $test$
begin
  if (select count(*) from public.tournament where slug like 'security-boundaries-%') <> 1 then
    raise exception 'anon tournament RLS exposed a draft tournament';
  end if;

  if exists (select 1 from public.team_public where tag = 'SBD')
    or not exists (select 1 from public.team_public where tag = 'SBP')
  then
    raise exception 'team_public did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.player_public where nickname = 'Draft Player')
    or not exists (select 1 from public.player_public where nickname = 'Public Player')
  then
    raise exception 'player_public did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.match where round_label = 'Draft round')
    or not exists (select 1 from public.match where round_label = 'Public round')
  then
    raise exception 'match RLS did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.match_map where map_name = 'de_draft')
    or not exists (select 1 from public.match_map where map_name = 'de_public')
    or exists (select 1 from public.match_map_public where map_name = 'de_draft')
    or not exists (select 1 from public.match_map_public where map_name = 'de_public')
  then
    raise exception 'match-map boundaries exposed draft data';
  end if;

  if exists (
    select 1 from public.photo where storage_key = 'security-boundaries/draft.webp'
  ) or not exists (
    select 1 from public.photo where storage_key = 'security-boundaries/public.webp'
  ) or exists (
    select 1 from public.photo_public where storage_key = 'security-boundaries/draft.webp'
  ) or not exists (
    select 1 from public.photo_public where storage_key = 'security-boundaries/public.webp'
  ) then
    raise exception 'photo boundaries exposed a draft object key';
  end if;

  if exists (select 1 from public.post where slug = 'security-boundaries-future')
    or not exists (select 1 from public.post where slug = 'security-boundaries-past')
  then
    raise exception 'post RLS exposed unpublished content';
  end if;

  if public.registration_status('security-boundaries-draft') is not null then
    raise exception 'registration_status exposed a draft tournament';
  end if;

  if (public.registration_status('security-boundaries-public') ->> 'cap')::integer <> 8 then
    raise exception 'registration_status hid a published tournament';
  end if;
end
$test$;

reset role;
set local role authenticated;

do $test$
begin
  if exists (select 1 from public.team_public where tag = 'SBD')
    or exists (select 1 from public.photo_public where storage_key like '%/draft.webp')
    or exists (select 1 from public.post where slug = 'security-boundaries-future')
  then
    raise exception 'authenticated public reads exposed unpublished data';
  end if;
end
$test$;

reset role;
set local role club_admin;

do $test$
begin
  if not exists (select 1 from public.tournament where slug = 'security-boundaries-draft')
    or not exists (select 1 from public.photo where storage_key = 'security-boundaries/draft.webp')
    or not exists (select 1 from public.post where slug = 'security-boundaries-future')
  then
    raise exception 'club_admin cannot review unpublished content';
  end if;

  if has_table_privilege('club_admin', 'public.registration_attempt', 'insert') then
    raise exception 'club_admin can bypass the guarded registration function';
  end if;

  if has_function_privilege('club_admin', 'public.submit_team(jsonb)', 'execute')
    or not has_function_privilege(
      'club_admin',
      'public.submit_team_rate_limited(text,jsonb)',
      'execute'
    )
  then
    raise exception 'club_admin registration function privileges are unsafe';
  end if;
end
$test$;

reset role;
rollback;

\echo 'security boundary regression tests passed'
