drop view if exists public.player_public;

create view public.player_public as
  select p.id, p.team_id, t.tournament_id, p.nickname, p.role, p.is_substitute, p.sort_order
  from public.player p
  join public.team t on t.id = p.team_id
  where t.status = 'approved';

grant select on public.player_public to anon, authenticated;
