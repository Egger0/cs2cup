-- Restore an application-owned administrator boundary without reintroducing
-- the provider-specific RPCs retired by the 021 Cloudflare Access cutover.
-- Password derivation happens in the trusted Worker with Web Crypto; only a
-- salted verifier is stored here and only SECURITY DEFINER wrappers are
-- reachable by the Hyperdrive login.

set local lock_timeout = '5s';

create table app_private.local_admin_credential (
  principal_id       uuid primary key
                       references app_private.principal(id) on delete restrict,
  username           text collate "C" not null unique,
  password_algorithm text not null,
  password_iterations integer not null,
  password_salt      bytea not null,
  password_hash      bytea not null,
  credential_version bigint not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint local_admin_credential_username_check
    check (
      char_length(username) between 1 and 128
      and username = btrim(username)
      and username !~ '[[:cntrl:]]'
    ),
  constraint local_admin_credential_algorithm_check
    check (password_algorithm = 'pbkdf2-hmac-sha256'),
  constraint local_admin_credential_iterations_check
    check (password_iterations = 600000),
  constraint local_admin_credential_salt_check
    check (octet_length(password_salt) = 16),
  constraint local_admin_credential_hash_check
    check (octet_length(password_hash) = 32),
  constraint local_admin_credential_version_check
    check (credential_version >= 1),
  constraint local_admin_credential_updated_at_check
    check (updated_at >= created_at)
);

create trigger local_admin_credential_set_updated_at
before update on app_private.local_admin_credential
for each row execute function app_private.set_updated_at();

create function app_private.set_local_admin_credential(
  p_username text,
  p_password_algorithm text,
  p_password_iterations integer,
  p_password_salt bytea,
  p_password_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now          timestamptz;
  v_principal_id uuid;
  v_principal_created  boolean := false;
  v_credential_created boolean;
begin
  perform app_private.require_session_request_id(p_request_id);
  if p_username is null
    or pg_catalog.char_length(p_username) not between 1 and 128
    or p_username collate "C" <> pg_catalog.btrim(p_username)
    or p_username collate "C" ~ '[[:cntrl:]]'
    or p_password_algorithm is distinct from 'pbkdf2-hmac-sha256'
    or p_password_iterations is distinct from 600000
    or p_password_salt is null
    or pg_catalog.octet_length(p_password_salt) <> 16
    or p_password_hash is null
    or pg_catalog.octet_length(p_password_hash) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'invalid local administrator credential';
  end if;

  -- Provisioning is deliberately serialized independently of the username so
  -- two concurrent first-run commands cannot create competing administrators.
  perform app_private.acquire_transaction_lock('local-admin-credential', 'global');

  select admin.principal_id
  into v_principal_id
  from public.admin_user admin
  where admin.user_id collate "C" = p_username collate "C";

  if not found then
    insert into app_private.principal default values
    returning id into v_principal_id;

    insert into public.admin_user (user_id, note, principal_id)
    values (p_username, 'Application-owned administrator', v_principal_id);
    v_principal_created := true;
  elsif v_principal_id is null then
    insert into app_private.principal default values
    returning id into v_principal_id;

    update public.admin_user
    set principal_id = v_principal_id
    where user_id collate "C" = p_username collate "C"
      and principal_id is null;

    if not found then
      raise exception using
        errcode = '55000',
        message = 'administrator principal changed during provisioning';
    end if;
    v_principal_created := true;
  end if;

  perform principal.id
  from app_private.principal principal
  where principal.id = v_principal_id
    and principal.status <> 'deleted'
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'administrator principal is unavailable';
  end if;

  v_now := pg_catalog.clock_timestamp();
  select not exists (
    select 1
    from app_private.local_admin_credential credential
    where credential.principal_id = v_principal_id
  ) into v_credential_created;

  if v_principal_created then
    insert into app_private.audit_event (
      occurred_at,
      actor_type,
      actor_principal_id,
      action,
      entity_type,
      entity_id,
      request_id,
      metadata
    ) values (
      v_now,
      'system',
      null,
      'principal.created',
      'principal',
      v_principal_id::text,
      p_request_id,
      '{"source":"local_admin_provisioning"}'::jsonb
    );
  end if;

  insert into app_private.local_admin_credential (
    principal_id,
    username,
    password_algorithm,
    password_iterations,
    password_salt,
    password_hash,
    created_at,
    updated_at
  ) values (
    v_principal_id,
    p_username,
    p_password_algorithm,
    p_password_iterations,
    p_password_salt,
    p_password_hash,
    v_now,
    v_now
  )
  on conflict (principal_id) do update
  set username = excluded.username,
      password_algorithm = excluded.password_algorithm,
      password_iterations = excluded.password_iterations,
      password_salt = excluded.password_salt,
      password_hash = excluded.password_hash,
      credential_version = app_private.local_admin_credential.credential_version + 1,
      updated_at = excluded.updated_at;

  -- Password creation and rotation invalidate every existing family before the
  -- new verifier becomes visible outside this transaction.
  perform app_private.revoke_principal_sessions(
    v_principal_id,
    null,
    null,
    'security_event',
    p_request_id
  );

  insert into app_private.audit_event (
    occurred_at,
    actor_type,
    actor_principal_id,
    action,
    entity_type,
    entity_id,
    request_id,
    metadata
  ) values (
    v_now,
    'system',
    null,
    'credential.changed',
    'credential',
    v_principal_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object(
      'created', v_credential_created,
      'algorithm', p_password_algorithm,
      'iterations', p_password_iterations
    )
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'principalId', v_principal_id,
    'credentialCreated', v_credential_created,
    'principalCreated', v_principal_created
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'local administrator credential already exists';
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'local administrator credential constraint violation';
end;
$$;

create function app_private.begin_local_admin_login(
  p_account_fingerprint bytea,
  p_network_fingerprint bytea,
  p_username text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_account_retry integer := 0;
  v_credential app_private.local_admin_credential%rowtype;
  v_network_retry integer;
  v_retry_after integer;
begin
  if p_username is null
    or pg_catalog.char_length(p_username) not between 1 and 128
    or p_username collate "C" <> pg_catalog.btrim(p_username)
    or p_username collate "C" ~ '[[:cntrl:]]'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid local administrator username';
  end if;

  perform app_private.require_session_digest(p_account_fingerprint);
  perform app_private.require_session_digest(p_network_fingerprint);

  -- All active local-administrator login calls use network -> account as their
  -- single lock order. Once a network is blocked, do not even touch an account
  -- row: otherwise a username spray could grow the throttle table without
  -- bound while skipping the expensive password derivation.
  v_network_retry := app_private.consume_login_throttle_dimension(
    'network',
    p_network_fingerprint,
    30
  );
  if v_network_retry = 0 then
    v_account_retry := app_private.consume_login_throttle_dimension(
      'account',
      p_account_fingerprint,
      5
    );
  end if;
  v_retry_after := greatest(v_network_retry, v_account_retry);

  -- Drain stale rows only after the endpoint has acquired all of its target
  -- throttle locks. Cleanup uses SKIP LOCKED and no later target lock is taken,
  -- so concurrent logins cannot form a cleanup -> throttle lock cycle. The
  -- private bounded call still drains state faster than this path can create it.
  perform app_private.cleanup_app_sessions(
    64,
    pg_catalog.gen_random_uuid()
  );

  if v_retry_after > 0 then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'allowed', false,
      'retryAfterSeconds', v_retry_after
    );
  end if;

  select credential.*
  into v_credential
  from app_private.local_admin_credential credential
  join app_private.principal principal
    on principal.id = credential.principal_id
  join public.admin_user admin
    on admin.principal_id = credential.principal_id
  where credential.username = p_username collate "C"
    and admin.user_id = credential.username collate "C"
    and principal.status = 'active';

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'allowed', true,
    -- Unknown and inactive usernames still return verifier-shaped data. The
    -- trusted service performs the same KDF, while the later admission check
    -- rejects this sentinel Principal/version atomically.
    'credential', pg_catalog.jsonb_build_object(
      'principalId', coalesce(
        v_credential.principal_id,
        '00000000-0000-4000-8000-000000000000'::uuid
      ),
      'username', coalesce(v_credential.username, p_username),
      'algorithm', coalesce(
        v_credential.password_algorithm,
        'pbkdf2-hmac-sha256'
      ),
      'iterations', coalesce(v_credential.password_iterations, 600000),
      'credentialVersion', coalesce(v_credential.credential_version, 1),
      'saltHex', coalesce(
        pg_catalog.encode(v_credential.password_salt, 'hex'),
        pg_catalog.repeat('00', 16)
      ),
      'hashHex', coalesce(
        pg_catalog.encode(v_credential.password_hash, 'hex'),
        pg_catalog.repeat('00', 32)
      )
    )
  );
end;
$$;

create function app_private.create_local_admin_session(
  p_principal_id uuid,
  p_credential_version bigint,
  p_token_hash bytea,
  p_account_fingerprint bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_existing_absolute_expires_at timestamptz;
  v_existing_idle_expires_at     timestamptz;
  v_existing_principal_id        uuid;
  v_existing_revoked_at          timestamptz;
  v_existing_session_id          uuid;
  v_existing_token_state         text;
  v_live_family_count integer;
  v_now               timestamptz;
  v_session           jsonb;
  v_username          text;
begin
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_digest(p_account_fingerprint);
  perform app_private.require_session_request_id(p_request_id);
  if p_credential_version is null or p_credential_version < 1 then
    raise exception using
      errcode = '22023',
      message = 'invalid local administrator credential version';
  end if;

  begin
    select credential.username
    into v_username
    from app_private.principal principal
    join app_private.local_admin_credential credential
      on credential.principal_id = principal.id
    join public.admin_user admin
      on admin.principal_id = principal.id
     and admin.user_id = credential.username collate "C"
    where principal.id = p_principal_id
      and principal.status = 'active'
      and credential.credential_version = p_credential_version
    for update of principal, credential;

    if not found then
      raise exception using
        errcode = 'P2B01',
        message = 'local administrator session admission denied';
    end if;

    v_now := pg_catalog.clock_timestamp();

    -- The Worker retries once with the same random token digest after an
    -- ambiguous transport failure. Serializing first on the Principal makes
    -- that retry observe either the committed family or a rolled-back insert;
    -- it can never create a second invisible session for the same attempt.
    select
      session_row.id,
      session_row.principal_id,
      session_row.revoked_at,
      session_row.idle_expires_at,
      session_row.absolute_expires_at,
      token.state
    into
      v_existing_session_id,
      v_existing_principal_id,
      v_existing_revoked_at,
      v_existing_idle_expires_at,
      v_existing_absolute_expires_at,
      v_existing_token_state
    from app_private.app_session_token token
    join app_private.app_session session_row
      on session_row.id = token.session_id
    where token.token_hash = p_token_hash
    for update of session_row, token;

    if found then
      if v_existing_principal_id <> p_principal_id
        or v_existing_token_state <> 'current'
        or v_existing_revoked_at is not null
        or v_existing_idle_expires_at <= v_now
        or v_existing_absolute_expires_at <= v_now
      then
        raise exception using
          errcode = 'P2B01',
          message = 'local administrator session admission denied';
      end if;

      perform app_private.clear_login_account_throttle(p_account_fingerprint);
      return pg_catalog.jsonb_build_object(
        'ok', true,
        'username', v_username,
        'sessionId', v_existing_session_id,
        'principalId', v_existing_principal_id,
        'idleExpiresAt', v_existing_idle_expires_at,
        'absoluteExpiresAt', v_existing_absolute_expires_at
      );
    end if;

    select pg_catalog.count(*)::integer
    into v_live_family_count
    from app_private.app_session session_row
    where session_row.principal_id = p_principal_id
      and session_row.revoked_at is null
      and session_row.idle_expires_at > v_now
      and session_row.absolute_expires_at > v_now;

    if v_live_family_count >= 5 then
      raise exception using
        errcode = 'P2B01',
        message = 'local administrator session admission denied';
    end if;

    v_session := app_private.create_app_session(
      p_principal_id,
      p_token_hash,
      p_request_id
    );
    perform app_private.clear_login_account_throttle(p_account_fingerprint);

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'username', v_username,
      'sessionId', v_session ->> 'sessionId',
      'principalId', v_session ->> 'principalId',
      'idleExpiresAt', v_session ->> 'idleExpiresAt',
      'absoluteExpiresAt', v_session ->> 'absoluteExpiresAt'
    );
  exception
    when sqlstate 'P2B01' then
      return pg_catalog.jsonb_build_object('ok', false);
  end;
end;
$$;

create function app_private.use_local_admin_session(
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now              timestamptz;
  v_session_id       uuid;
  v_principal_id     uuid;
  v_principal_status text;
  v_session          app_private.app_session%rowtype;
  v_username         text;
begin
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_request_id(p_request_id);

  select token.session_id, session_row.principal_id
  into v_session_id, v_principal_id
  from app_private.app_session_token token
  join app_private.app_session session_row on session_row.id = token.session_id
  where token.token_hash = p_token_hash
    and token.state = 'current';

  if not found then
    return '{"ok":false}'::jsonb;
  end if;

  select principal.status
  into v_principal_status
  from app_private.principal principal
  where principal.id = v_principal_id
  for share;

  if not found then
    return '{"ok":false}'::jsonb;
  end if;

  select session_row.*
  into v_session
  from app_private.app_session session_row
  where session_row.id = v_session_id
    and session_row.principal_id = v_principal_id
  for update;

  if not found
    or v_session.revoked_at is not null
    or not exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = p_token_hash
        and token.session_id = v_session_id
        and token.state = 'current'
    )
  then
    return '{"ok":false}'::jsonb;
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_session.idle_expires_at
    or v_now >= v_session.absolute_expires_at
  then
    return '{"ok":false}'::jsonb;
  end if;

  select credential.username
  into v_username
  from app_private.local_admin_credential credential
  join public.admin_user admin
    on admin.principal_id = credential.principal_id
   and admin.user_id = credential.username collate "C"
  where credential.principal_id = v_principal_id;

  if v_principal_status <> 'active' or not found then
    update app_private.app_session
    set revoked_at = v_now,
        revoke_reason = case
          when v_principal_status <> 'active' then 'principal_status'
          else 'security_event'
        end
    where id = v_session_id;

    insert into app_private.audit_event (
      occurred_at,
      actor_type,
      actor_principal_id,
      action,
      entity_type,
      entity_id,
      request_id,
      metadata
    ) values (
      v_now,
      'system',
      null,
      'session.revoked',
      'session',
      v_session_id::text,
      p_request_id,
      pg_catalog.jsonb_build_object(
        'reason', case
          when v_principal_status <> 'active' then 'principal_status'
          else 'security_event'
        end
      )
    );

    return '{"ok":false}'::jsonb;
  end if;

  update app_private.app_session
  set last_seen_at = v_now,
      idle_expires_at = least(
        v_now + interval '30 minutes',
        v_session.absolute_expires_at
      )
  where id = v_session_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'username', v_username,
    'principalId', v_principal_id,
    'sessionId', v_session_id,
    'idleExpiresAt', least(
      v_now + interval '30 minutes',
      v_session.absolute_expires_at
    ),
    'absoluteExpiresAt', v_session.absolute_expires_at
  );
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'local administrator session constraint violation';
end;
$$;

create function app_private.end_local_admin_session(
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, app_private
as $$
  select app_private.logout_app_session($1, $2);
$$;

create function public.begin_local_admin_login(bytea, bytea, text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.begin_local_admin_login($1, $2, $3);
end;
$$;

create function public.create_local_admin_session(uuid, bigint, bytea, bytea, uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.create_local_admin_session($1, $2, $3, $4, $5);
end;
$$;

create function public.use_local_admin_session(bytea, uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.use_local_admin_session($1, $2);
end;
$$;

create function public.end_local_admin_session(bytea, uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.end_local_admin_session($1, $2);
end;
$$;

alter table app_private.local_admin_credential enable row level security;
revoke all on table app_private.local_admin_credential
  from public, anon, authenticated;
revoke all on all functions in schema app_private
  from public, anon, authenticated;
revoke all on function public.begin_local_admin_login(bytea, bytea, text)
  from public, anon, authenticated;
revoke all on function public.create_local_admin_session(uuid, bigint, bytea, bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.use_local_admin_session(bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.end_local_admin_session(bytea, uuid)
  from public, anon, authenticated;

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
        'revoke all on all functions in schema app_private from %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.begin_local_admin_login(bytea,bytea,text) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.create_local_admin_session(uuid,bigint,bytea,bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.use_local_admin_session(bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.end_local_admin_session(bytea,uuid) to %I',
        v_role
      );
    end if;
  end loop;
end
$acl$;

comment on table app_private.local_admin_credential is
  'Application-owned administrator usernames and peppered PBKDF2 verifiers; raw passwords are never persisted.';
comment on function app_private.set_local_admin_credential(text, text, integer, bytea, bytea, uuid) is
  'Migration-owner-only administrator credential provisioning and rotation boundary.';
comment on function public.begin_local_admin_login(bytea, bytea, text) is
  'Trusted-service atomic account/network throttle reservation and verifier lookup.';
comment on function public.create_local_admin_session(uuid, bigint, bytea, bytea, uuid) is
  'Trusted-service administrator session admission with a five-family cap.';
comment on function public.use_local_admin_session(bytea, uuid) is
  'Trusted-service administrator session validation and idle-expiry touch.';
comment on function public.end_local_admin_session(bytea, uuid) is
  'Trusted-service idempotent administrator logout boundary.';

notify pgrst, 'reload schema';
