do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'club_admin') then
    create role club_admin nologin;
  end if;
end
$$;

grant usage on schema public to club_admin;

grant select, insert, update, delete on
  public.game, public.tournament, public.team, public.player,
  public.match, public.match_map, public.photo,
  public.post, public.club_member, public.admin_user
  to club_admin;

grant select, update on public.site_setting to club_admin;
grant select on public.team_public, public.player_public, public.match_map_public to club_admin;

drop policy if exists game_admin_write on public.game;
create policy game_admin_write on public.game for all
  to club_admin using (true) with check (true);

drop policy if exists tournament_admin_write on public.tournament;
create policy tournament_admin_write on public.tournament for all
  to club_admin using (true) with check (true);

drop policy if exists team_admin_write on public.team;
create policy team_admin_write on public.team for all
  to club_admin using (true) with check (true);

drop policy if exists player_admin_write on public.player;
create policy player_admin_write on public.player for all
  to club_admin using (true) with check (true);

drop policy if exists match_admin_write on public.match;
create policy match_admin_write on public.match for all
  to club_admin using (true) with check (true);

drop policy if exists match_map_admin_write on public.match_map;
create policy match_map_admin_write on public.match_map for all
  to club_admin using (true) with check (true);

drop policy if exists photo_admin_write on public.photo;
create policy photo_admin_write on public.photo for all
  to club_admin using (true) with check (true);

drop policy if exists post_admin_write on public.post;
create policy post_admin_write on public.post for all
  to club_admin using (true) with check (true);

drop policy if exists club_member_admin_write on public.club_member;
create policy club_member_admin_write on public.club_member for all
  to club_admin using (true) with check (true);

drop policy if exists admin_user_admin_read on public.admin_user;
create policy admin_user_admin_read on public.admin_user for select
  to club_admin using (true);

drop policy if exists site_setting_admin_write on public.site_setting;
create policy site_setting_admin_write on public.site_setting for update
  to club_admin using (true) with check (true);
