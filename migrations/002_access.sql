do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

create or replace view public.team_public as
  select id, tournament_id, name, tag, captain, dept, seed
  from public.team
  where status = 'approved';

alter table public.player add column if not exists role text;

create unique index if not exists player_team_nickname_key
  on public.player (team_id, nickname);

drop view if exists public.player_public;

create view public.player_public as
  select p.id, p.team_id, t.tournament_id, p.nickname, p.role, p.is_substitute, p.sort_order
  from public.player p
  join public.team t on t.id = p.team_id
  where t.status = 'approved';

alter table public.site_setting enable row level security;
alter table public.tournament  enable row level security;
alter table public.team        enable row level security;
alter table public.player      enable row level security;
alter table public.match       enable row level security;
alter table public.photo       enable row level security;
alter table public.admin_user  enable row level security;

drop policy if exists site_setting_read on public.site_setting;
create policy site_setting_read on public.site_setting for select using (true);

drop policy if exists tournament_read on public.tournament;
create policy tournament_read on public.tournament for select using (status <> 'draft');

drop policy if exists match_read on public.match;
create policy match_read on public.match for select using (true);

drop policy if exists photo_read on public.photo;
create policy photo_read on public.photo for select using (true);

revoke all on public.team from anon, authenticated;
revoke all on public.player from anon, authenticated;
revoke all on public.admin_user from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.site_setting, public.tournament, public.match, public.photo to anon, authenticated;
grant select on public.team_public, public.player_public to anon, authenticated;
