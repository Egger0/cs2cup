revoke execute on function public.submit_team(jsonb) from anon, authenticated, public;

create table if not exists public.registration_attempt (
  id            bigint generated always as identity primary key,
  fingerprint   text not null,
  tournament_id bigint references public.tournament(id) on delete cascade,
  accepted      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists registration_attempt_window_idx
  on public.registration_attempt (fingerprint, created_at desc);

alter table public.registration_attempt enable row level security;

revoke all on public.registration_attempt from anon, authenticated;

create or replace function public.recent_registration_attempts(p_fingerprint text, p_minutes integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.registration_attempt
  where fingerprint = p_fingerprint
    and created_at > now() - make_interval(mins => p_minutes);
$$;

revoke execute on function public.recent_registration_attempts(text, integer) from public;
