-- Stable application principals are deliberately separate from transport
-- roles and external authentication subjects. Sensitive identity, profile,
-- authorization, ownership, and audit records remain outside the PostgREST
-- exposed public schema.

-- Adding nullable bridges and their indexes requires brief locks on two live
-- tables. Fail instead of waiting indefinitely behind application traffic.
set local lock_timeout = '5s';

create table app_private.principal (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint principal_status_check
    check (status in ('active', 'suspended', 'deleted')),
  constraint principal_updated_at_check
    check (updated_at >= created_at),
  constraint principal_deleted_at_check
    check (
      (status = 'deleted' and deleted_at is not null and deleted_at >= created_at)
      or (status <> 'deleted' and deleted_at is null)
    )
);

create table app_private.principal_identity (
  id               bigint generated always as identity primary key,
  principal_id     uuid not null
                     references app_private.principal(id) on delete restrict,
  provider         text collate "C" not null,
  issuer           text collate "C" not null,
  subject          text collate "C" not null,
  created_at       timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  constraint principal_identity_provider_check
    check (provider ~ '^[a-z][a-z0-9_-]{0,31}$'),
  constraint principal_identity_issuer_check
    check (
      char_length(issuer) between 1 and 512
      and issuer = btrim(issuer)
      and issuer !~ '[[:cntrl:]]'
    ),
  constraint principal_identity_subject_check
    check (
      char_length(subject) between 1 and 512
      and subject = btrim(subject)
      and subject !~ '[[:cntrl:]]'
    ),
  constraint principal_identity_verified_at_check
    check (last_verified_at >= created_at),
  constraint principal_identity_namespace_key
    unique (provider, issuer, subject)
);

create index principal_identity_principal_idx
  on app_private.principal_identity (principal_id);

create table app_private.principal_profile (
  principal_id uuid primary key
                 references app_private.principal(id) on delete cascade,
  display_name text not null,
  handle       text,
  bio          text,
  visibility   text not null default 'private',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint principal_profile_display_name_check
    check (
      char_length(btrim(display_name)) between 1 and 80
      and display_name = btrim(display_name)
      and display_name !~ '[[:cntrl:]]'
    ),
  constraint principal_profile_handle_check
    check (handle is null or handle ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  constraint principal_profile_bio_check
    check (bio is null or char_length(bio) <= 280),
  constraint principal_profile_visibility_check
    check (visibility in ('private', 'public')),
  constraint principal_profile_updated_at_check
    check (updated_at >= created_at)
);

create unique index principal_profile_handle_key
  on app_private.principal_profile (lower(handle))
  where handle is not null;

create table app_private.role_assignment (
  id            bigint generated always as identity primary key,
  principal_id  uuid not null
                  references app_private.principal(id) on delete restrict,
  role          text not null,
  tournament_id bigint references public.tournament(id) on delete cascade,
  granted_by    uuid references app_private.principal(id) on delete restrict,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  constraint role_assignment_role_check
    check (
      role in (
        'platform_admin',
        'content_editor',
        'tournament_manager',
        'registration_reviewer',
        'match_reporter'
      )
    ),
  constraint role_assignment_scope_check
    check (
      (role in ('platform_admin', 'content_editor') and tournament_id is null)
      or (
        role in ('tournament_manager', 'registration_reviewer', 'match_reporter')
        and tournament_id is not null
      )
    ),
  constraint role_assignment_revoked_at_check
    check (revoked_at is null or revoked_at >= created_at)
);

create unique index role_assignment_active_global_key
  on app_private.role_assignment (principal_id, role)
  where revoked_at is null and tournament_id is null;

create unique index role_assignment_active_tournament_key
  on app_private.role_assignment (principal_id, role, tournament_id)
  where revoked_at is null and tournament_id is not null;

create index role_assignment_tournament_idx
  on app_private.role_assignment (tournament_id, role)
  where revoked_at is null and tournament_id is not null;

create table app_private.team_ownership (
  id           bigint generated always as identity primary key,
  team_id      bigint not null references public.team(id) on delete cascade,
  principal_id uuid not null
                 references app_private.principal(id) on delete restrict,
  role         text not null,
  granted_by   uuid references app_private.principal(id) on delete restrict,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint team_ownership_role_check
    check (role in ('owner', 'manager')),
  constraint team_ownership_revoked_at_check
    check (revoked_at is null or revoked_at >= created_at)
);

create unique index team_ownership_active_principal_key
  on app_private.team_ownership (team_id, principal_id)
  where revoked_at is null;

create unique index team_ownership_active_owner_key
  on app_private.team_ownership (team_id)
  where revoked_at is null and role = 'owner';

create index team_ownership_principal_idx
  on app_private.team_ownership (principal_id, team_id)
  where revoked_at is null;

create table app_private.audit_event (
  id                 bigint generated always as identity primary key,
  occurred_at        timestamptz not null default now(),
  actor_type          text not null,
  actor_principal_id uuid
                       references app_private.principal(id) on delete restrict,
  action             text not null,
  entity_type        text not null,
  entity_id          text not null,
  -- Scoped audit evidence retains its tournament relationship. Retain the
  -- tournament instead of rewriting immutable audit history.
  tournament_id      bigint references public.tournament(id) on delete restrict,
  request_id         uuid,
  metadata           jsonb not null default '{}'::jsonb,
  constraint audit_event_actor_type_check
    check (actor_type in ('system', 'principal', 'anonymous')),
  constraint audit_event_actor_check
    check (
      (actor_type = 'principal' and actor_principal_id is not null)
      or (actor_type in ('system', 'anonymous') and actor_principal_id is null)
    ),
  constraint audit_event_action_check
    check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint audit_event_entity_type_check
    check (entity_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint audit_event_entity_id_check
    check (char_length(entity_id) between 1 and 128),
  constraint audit_event_metadata_check
    check (
      jsonb_typeof(metadata) = 'object'
      and octet_length(metadata::text) <= 8192
    )
);

create index audit_event_occurred_at_idx
  on app_private.audit_event (occurred_at desc);

create index audit_event_entity_idx
  on app_private.audit_event (entity_type, entity_id, occurred_at desc);

create index audit_event_actor_idx
  on app_private.audit_event (actor_principal_id, occurred_at desc)
  where actor_principal_id is not null;

create index audit_event_tournament_idx
  on app_private.audit_event (tournament_id, occurred_at desc)
  where tournament_id is not null;

alter table public.admin_user
  add column principal_id uuid
    references app_private.principal(id) on delete restrict;

alter table public.admin_user
  add constraint admin_user_principal_id_key unique (principal_id);

alter table public.player
  add column principal_id uuid
    references app_private.principal(id) on delete restrict;

create unique index player_team_principal_key
  on public.player (team_id, principal_id)
  where principal_id is not null;

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create trigger principal_set_updated_at
before update on app_private.principal
for each row execute function app_private.set_updated_at();

create trigger principal_profile_set_updated_at
before update on app_private.principal_profile
for each row execute function app_private.set_updated_at();

create or replace function app_private.reject_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'audit events are append-only';
end;
$$;

create trigger audit_event_reject_update_or_delete
before update or delete on app_private.audit_event
for each row execute function app_private.reject_audit_event_mutation();

create trigger audit_event_reject_truncate
before truncate on app_private.audit_event
for each statement execute function app_private.reject_audit_event_mutation();

create or replace function app_private.ensure_principal_identity(
  p_provider text,
  p_issuer text,
  p_subject text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now          timestamptz;
  v_principal_id uuid;
begin
  if p_provider is null
    or p_provider collate "C" !~ '^[a-z][a-z0-9_-]{0,31}$'
    or p_issuer is null
    or pg_catalog.char_length(p_issuer) not between 1 and 512
    or p_issuer collate "C" <> pg_catalog.btrim(p_issuer)
    or p_issuer collate "C" ~ '[[:cntrl:]]'
    or p_subject is null
    or pg_catalog.char_length(p_subject) not between 1 and 512
    or p_subject collate "C" <> pg_catalog.btrim(p_subject)
    or p_subject collate "C" ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid principal identity namespace';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.jsonb_build_array(p_provider, p_issuer, p_subject)::text,
      20260828
    )
  );

  -- Sample only after the tuple lock. A caller that waited behind identity
  -- creation must never write a timestamp older than that new row.
  v_now := pg_catalog.clock_timestamp();

  select identity.principal_id
  into v_principal_id
  from app_private.principal_identity identity
  join app_private.principal principal on principal.id = identity.principal_id
  where identity.provider = p_provider collate "C"
    and identity.issuer = p_issuer collate "C"
    and identity.subject = p_subject collate "C"
    and principal.status <> 'deleted'
  for update of identity;

  if found then
    update app_private.principal_identity
    set last_verified_at = greatest(last_verified_at, v_now)
    where provider = p_provider collate "C"
      and issuer = p_issuer collate "C"
      and subject = p_subject collate "C";

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'principalId', v_principal_id,
      'created', false
    );
  end if;

  -- A deleted principal never silently regains access through the same external
  -- identity. Account recovery or relinking requires a separately reviewed
  -- lifecycle operation.
  if exists (
    select 1
    from app_private.principal_identity identity
    where identity.provider = p_provider collate "C"
      and identity.issuer = p_issuer collate "C"
      and identity.subject = p_subject collate "C"
  ) then
    raise exception using
      errcode = '55000',
      message = 'principal identity is not active';
  end if;

  insert into app_private.principal default values
  returning id into v_principal_id;

  insert into app_private.principal_identity (
    principal_id,
    provider,
    issuer,
    subject,
    created_at,
    last_verified_at
  ) values (
    v_principal_id,
    p_provider,
    p_issuer,
    p_subject,
    v_now,
    v_now
  );

  insert into app_private.audit_event (
    occurred_at,
    actor_type,
    actor_principal_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    v_now,
    'system',
    null,
    'principal.created',
    'principal',
    v_principal_id::text,
    '{}'::jsonb
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'principalId', v_principal_id,
    'created', true
  );
end;
$$;

create or replace function public.ensure_principal_identity(
  p_provider text,
  p_issuer text,
  p_subject text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.ensure_principal_identity(p_provider, p_issuer, p_subject);
end;
$$;

alter table app_private.principal enable row level security;
alter table app_private.principal_identity enable row level security;
alter table app_private.principal_profile enable row level security;
alter table app_private.role_assignment enable row level security;
alter table app_private.team_ownership enable row level security;
alter table app_private.audit_event enable row level security;

revoke all on table
  app_private.principal,
  app_private.principal_identity,
  app_private.principal_profile,
  app_private.role_assignment,
  app_private.team_ownership,
  app_private.audit_event
from public, anon, authenticated;

revoke all on all sequences in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.ensure_principal_identity(text, text, text)
  from public, anon, authenticated;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Preserve the
-- private-schema invariant for routines created by this migration identity.
alter default privileges in schema app_private
  revoke execute on functions from public;

do $acl$
declare
  v_role text;
begin
  foreach v_role in array array['club_admin', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      execute pg_catalog.format('revoke usage on schema app_private from %I', v_role);
      execute pg_catalog.format(
        'revoke all on all tables in schema app_private from %I',
        v_role
      );
      execute pg_catalog.format(
        'revoke all on all sequences in schema app_private from %I',
        v_role
      );
      execute pg_catalog.format(
        'revoke all on all functions in schema app_private from %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.ensure_principal_identity(text,text,text) to %I',
        v_role
      );
    end if;
  end loop;
end
$acl$;

comment on table app_private.principal is
  'Stable application subjects; external authentication identifiers are stored separately.';
comment on table app_private.principal_identity is
  'Private, provider-namespaced authentication bindings. Subjects are opaque and never public.';
comment on table app_private.principal_profile is
  'Private-by-default participant profile data. Public projection is intentionally deferred.';
comment on table app_private.role_assignment is
  'Revocable platform-wide and tournament-scoped application roles.';
comment on table app_private.team_ownership is
  'Revocable ownership and management of a tournament-specific team entry.';
comment on table app_private.audit_event is
  'Append-only, data-minimized application audit events.';
comment on function public.ensure_principal_identity(text, text, text) is
  'Trusted-service identity resolver. Returns only the stable principal ID and creation state.';

notify pgrst, 'reload schema';
