-- Public records are publishable only with their parent tournament. Keep the
-- explicit predicates even though the base tables also use RLS: PostgreSQL
-- views normally execute with their owner's privileges.
create or replace view public.team_public
with (security_barrier = true) as
  select tm.id, tm.tournament_id, tm.name, tm.tag, tm.captain, tm.dept, tm.seed
  from public.team tm
  join public.tournament tr on tr.id = tm.tournament_id
  where tm.status = 'approved'
    and tr.status <> 'draft';

create or replace view public.player_public
with (security_barrier = true) as
  select p.id, p.team_id, tm.tournament_id, p.nickname, p.role,
         p.is_substitute, p.sort_order
  from public.player p
  join public.team tm on tm.id = p.team_id
  join public.tournament tr on tr.id = tm.tournament_id
  where tm.status = 'approved'
    and tr.status <> 'draft';

create or replace view public.match_map_public
with (security_barrier = true) as
  select mm.id, mm.match_id, mm.pick_order, mm.map_name, mm.action,
         mm.chosen_by, mm.score_a, mm.score_b, mm.played
  from public.match_map mm
  join public.match m on m.id = mm.match_id
  join public.tournament tr on tr.id = m.tournament_id
  where tr.status <> 'draft';

create or replace view public.photo_public
with (security_barrier = true) as
  select p.id, p.tournament_id, p.storage_key, p.width, p.height,
         p.blur_data_url, p.caption, p.sort_order, p.created_at
  from public.photo p
  join public.tournament tr on tr.id = p.tournament_id
  where tr.status <> 'draft';

drop policy if exists match_read on public.match;
create policy match_read on public.match for select using (
  exists (
    select 1
    from public.tournament tr
    where tr.id = tournament_id
      and tr.status <> 'draft'
  )
);

drop policy if exists match_map_read on public.match_map;
create policy match_map_read on public.match_map for select using (
  exists (
    select 1
    from public.match m
    join public.tournament tr on tr.id = m.tournament_id
    where m.id = match_id
      and tr.status <> 'draft'
  )
);

drop policy if exists photo_read on public.photo;
create policy photo_read on public.photo for select using (
  exists (
    select 1
    from public.tournament tr
    where tr.id = tournament_id
      and tr.status <> 'draft'
  )
);

drop policy if exists post_read on public.post;
create policy post_read on public.post for select using (published_at <= now());

create or replace function public.registration_status(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cap', tr.team_cap,
    'taken', (
      select count(*)
      from public.team tm
      where tm.tournament_id = tr.id
        and tm.status <> 'rejected'
    ),
    'open', tr.status in ('registration', 'postponed')
  )
  from public.tournament tr
  where tr.slug = p_slug
    and tr.status <> 'draft';
$$;

grant select on public.photo_public to anon, authenticated;

-- CloudBase managed PostgreSQL does not permit CREATE ROLE. In that
-- environment the admin API key supplies its own database identity, so role
-- setup is intentionally optional. Local PostgreSQL creates a narrowly scoped
-- PostgREST role instead of exposing postgres as the anonymous request role.
do $migration$
declare
  v_role_available boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'club_admin') then
    begin
      create role club_admin
        nologin
        nosuperuser
        nocreatedb
        nocreaterole
        noinherit
        noreplication
        nobypassrls;
    exception
      when insufficient_privilege or feature_not_supported then
        raise notice 'CREATE ROLE is unavailable; skipping local club_admin setup';
    end;
  end if;

  select exists (select 1 from pg_roles where rolname = 'club_admin')
  into v_role_available;

  if not v_role_available then
    return;
  end if;

  begin
    alter role club_admin
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  exception
    when insufficient_privilege then
      raise notice 'ALTER ROLE is unavailable; preserving the existing club_admin attributes';
  end;

  grant usage on schema public to club_admin;

  revoke all on table
    public.site_setting,
    public.game,
    public.tournament,
    public.team,
    public.player,
    public.match,
    public.photo,
    public.admin_user,
    public.match_map,
    public.club_member,
    public.post,
    public.registration_attempt,
    public.team_public,
    public.player_public,
    public.match_map_public,
    public.photo_public
  from club_admin;

  grant select, update on public.site_setting to club_admin;
  grant select, insert, update, delete on public.game, public.tournament, public.photo, public.post
    to club_admin;
  grant select, update, delete on public.team to club_admin;
  grant select on public.player, public.match_map, public.admin_user to club_admin;
  grant select, update on public.match, public.club_member to club_admin;
  grant select, insert on public.registration_attempt to club_admin;
  grant select on public.team_public, public.player_public, public.match_map_public,
    public.photo_public to club_admin;

  grant usage, select on sequence
    public.game_id_seq,
    public.tournament_id_seq,
    public.photo_id_seq,
    public.post_id_seq,
    public.registration_attempt_id_seq
  to club_admin;

  grant execute on function public.registration_status(text) to club_admin;
  if to_regprocedure('public.recent_registration_attempts(text,integer)') is not null then
    grant execute on function public.recent_registration_attempts(text, integer) to club_admin;
  end if;

  if to_regprocedure('public.submit_team_rate_limited(text,jsonb)') is not null then
    revoke execute on function public.submit_team(jsonb) from club_admin;
    grant execute on function public.submit_team_rate_limited(text, jsonb) to club_admin;
  else
    grant execute on function public.submit_team(jsonb) to club_admin;
  end if;
  grant execute on function public.set_team_seed(bigint, bigint, integer) to club_admin;
  grant execute on function public.replace_bracket(bigint, bigint[], integer[]) to club_admin;
  grant execute on function public.save_match_score(bigint, bigint, bigint, integer, integer)
    to club_admin;
  grant execute on function public.save_match_report(bigint, bigint, bigint, jsonb)
    to club_admin;
  grant execute on function public.replace_match_schedule(
    bigint,
    bigint[],
    timestamptz[],
    timestamptz[]
  ) to club_admin;

  drop policy if exists site_setting_admin_write on public.site_setting;
  create policy site_setting_admin_write on public.site_setting
    for update to club_admin using (true) with check (true);

  drop policy if exists game_admin_write on public.game;
  create policy game_admin_write on public.game
    for all to club_admin using (true) with check (true);

  drop policy if exists tournament_admin_write on public.tournament;
  create policy tournament_admin_write on public.tournament
    for all to club_admin using (true) with check (true);

  drop policy if exists team_admin_write on public.team;
  create policy team_admin_write on public.team
    for all to club_admin using (true) with check (true);

  drop policy if exists player_admin_write on public.player;
  create policy player_admin_write on public.player
    for all to club_admin using (true) with check (true);

  drop policy if exists match_admin_write on public.match;
  create policy match_admin_write on public.match
    for all to club_admin using (true) with check (true);

  drop policy if exists photo_admin_write on public.photo;
  create policy photo_admin_write on public.photo
    for all to club_admin using (true) with check (true);

  drop policy if exists admin_user_admin_read on public.admin_user;
  create policy admin_user_admin_read on public.admin_user
    for select to club_admin using (true);

  drop policy if exists match_map_admin_write on public.match_map;
  create policy match_map_admin_write on public.match_map
    for all to club_admin using (true) with check (true);

  drop policy if exists club_member_admin_write on public.club_member;
  create policy club_member_admin_write on public.club_member
    for all to club_admin using (true) with check (true);

  drop policy if exists post_admin_write on public.post;
  create policy post_admin_write on public.post
    for all to club_admin using (true) with check (true);

  drop policy if exists registration_attempt_admin on public.registration_attempt;
  create policy registration_attempt_admin on public.registration_attempt
    for insert to club_admin with check (true);
end
$migration$;

notify pgrst, 'reload schema';
