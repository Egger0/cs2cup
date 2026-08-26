create table if not exists public.site_setting (
  id             integer primary key default 1 check (id = 1),
  club_name      text not null,
  club_name_en   text,
  school         text not null,
  logo_url       text,
  contact_qq     text,
  contact_wechat text,
  footer_copy    text
);

create table if not exists public.tournament (
  id            bigint generated always as identity primary key,
  slug          text not null unique,
  title         text not null,
  game          text not null default 'cs2',
  season        text not null,
  edition       integer not null,
  status        text not null default 'draft'
                check (status in ('draft', 'registration', 'running', 'finished', 'postponed')),
  format        text not null default 'single_elimination',
  team_cap      integer not null default 16 check (team_cap > 0),
  reg_deadline  timestamptz,
  starts_at     timestamptz,
  accent_color  text,
  map_pool      jsonb not null default '[]'::jsonb,
  rules         jsonb not null default '[]'::jsonb,
  faqs          jsonb not null default '[]'::jsonb,
  hero_eyebrow  text not null default '',
  hero_top      text not null default '',
  hero_bottom   text not null default '',
  lede          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists tournament_status_idx on public.tournament (status);

create table if not exists public.team (
  id            bigint generated always as identity primary key,
  tournament_id bigint not null references public.tournament(id) on delete cascade,
  name          text not null,
  tag           text not null,
  captain       text not null,
  contact       text not null,
  dept          text,
  note          text,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  seed          integer,
  created_at    timestamptz not null default now(),
  unique (tournament_id, tag),
  unique (tournament_id, name)
);

create index if not exists team_tournament_status_idx
  on public.team (tournament_id, status);

create table if not exists public.player (
  id            bigint generated always as identity primary key,
  team_id       bigint not null references public.team(id) on delete cascade,
  nickname      text not null,
  role          text,
  is_substitute boolean not null default false,
  sort_order    integer not null default 0,
  unique (team_id, nickname)
);

create index if not exists player_team_idx on public.player (team_id);

create table if not exists public.match (
  id                bigint generated always as identity primary key,
  tournament_id     bigint not null references public.tournament(id) on delete cascade,
  round             integer not null,
  slot              integer not null,
  round_label       text not null,
  best_of           integer not null default 3 check (best_of % 2 = 1),
  team_a_id         bigint references public.team(id) on delete set null,
  team_b_id         bigint references public.team(id) on delete set null,
  source_match_a_id bigint references public.match(id) on delete set null,
  source_match_b_id bigint references public.match(id) on delete set null,
  score_a           integer check (score_a >= 0),
  score_b           integer check (score_b >= 0),
  winner_team_id    bigint references public.team(id) on delete set null,
  scheduled_at      timestamptz,
  unique (tournament_id, round, slot)
);

create index if not exists match_tournament_idx on public.match (tournament_id, round, slot);

create table if not exists public.photo (
  id            bigint generated always as identity primary key,
  tournament_id bigint not null references public.tournament(id) on delete cascade,
  storage_key   text not null,
  width         integer not null check (width > 0),
  height        integer not null check (height > 0),
  blur_data_url text,
  caption       text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists photo_tournament_idx on public.photo (tournament_id, sort_order);

create table if not exists public.admin_user (
  user_id    text primary key,
  note       text,
  created_at timestamptz not null default now()
);
