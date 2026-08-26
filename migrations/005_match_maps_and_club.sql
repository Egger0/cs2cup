create table if not exists public.match_map (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references public.match(id) on delete cascade,
  pick_order integer not null,
  map_name   text not null,
  action     text not null check (action in ('ban', 'pick', 'decider')),
  chosen_by  text check (chosen_by in ('a', 'b')),
  score_a    integer check (score_a >= 0),
  score_b    integer check (score_b >= 0),
  played     boolean not null default false,
  unique (match_id, pick_order)
);

create index if not exists match_map_match_idx on public.match_map (match_id, pick_order);

create unique index if not exists club_member_role_key on public.club_member (role);

create table if not exists public.club_member (
  id         bigint generated always as identity primary key,
  name       text not null,
  role       text not null,
  handle     text,
  intro      text,
  sort_order integer not null default 0,
  unique (role)
);

create table if not exists public.post (
  id           bigint generated always as identity primary key,
  slug         text not null unique,
  title        text not null,
  summary      text not null,
  body         text not null,
  published_at timestamptz not null default now(),
  pinned       boolean not null default false
);

create index if not exists post_published_idx on public.post (published_at desc);

create or replace view public.match_map_public as
  select mm.id, mm.match_id, mm.pick_order, mm.map_name, mm.action,
         mm.chosen_by, mm.score_a, mm.score_b, mm.played
  from public.match_map mm;

alter table public.match_map   enable row level security;
alter table public.club_member enable row level security;
alter table public.post        enable row level security;

drop policy if exists match_map_read on public.match_map;
create policy match_map_read on public.match_map for select using (true);

drop policy if exists club_member_read on public.club_member;
create policy club_member_read on public.club_member for select using (true);

drop policy if exists post_read on public.post;
create policy post_read on public.post for select using (true);

grant select on public.match_map, public.match_map_public, public.club_member, public.post
  to anon, authenticated;
