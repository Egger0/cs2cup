alter table public.tournament
  add column if not exists champion_name text,
  add column if not exists champion_note text;
