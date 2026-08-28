-- Provider-neutral, revocable application sessions remain inert until the
-- separately reviewed cookie cutover. Only fixed-size digests and keyed login
-- fingerprints are persisted; raw provider or application credentials never
-- enter the database.

set local lock_timeout = '5s';

create table app_private.app_session (
  id                  uuid primary key default gen_random_uuid(),
  principal_id        uuid not null
                        references app_private.principal(id) on delete restrict,
  created_at          timestamptz not null,
  last_seen_at        timestamptz not null,
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  rotate_after        timestamptz not null,
  rotation_count      integer not null default 0,
  revoked_at          timestamptz,
  revoke_reason       text,
  constraint app_session_time_order_check
    check (
      last_seen_at >= created_at
      and idle_expires_at = least(
        last_seen_at + interval '30 minutes',
        absolute_expires_at
      )
      and idle_expires_at > last_seen_at
      and idle_expires_at <= absolute_expires_at
      and absolute_expires_at = created_at + interval '8 hours'
      and rotate_after > created_at
      and rotate_after <= absolute_expires_at
    ),
  constraint app_session_rotation_count_check
    check (rotation_count >= 0),
  constraint app_session_revocation_check
    check (
      (revoked_at is null and revoke_reason is null)
      or (
        revoked_at is not null
        and revoked_at >= last_seen_at
        and revoke_reason in (
          'logout',
          'administrator',
          'security_event',
          'principal_status',
          'token_reuse'
        )
      )
    )
);

create index app_session_principal_active_idx
  on app_private.app_session (principal_id, created_at desc)
  where revoked_at is null;

create index app_session_active_expiry_idx
  on app_private.app_session (
    (least(idle_expires_at, absolute_expires_at)),
    id
  )
  where revoked_at is null;

create index app_session_revoked_at_idx
  on app_private.app_session (revoked_at, id)
  where revoked_at is not null;

create table app_private.app_session_token (
  token_hash  bytea primary key,
  session_id  uuid not null
                references app_private.app_session(id) on delete cascade,
  state       text not null,
  created_at  timestamptz not null,
  valid_until timestamptz,
  constraint app_session_token_hash_check
    check (octet_length(token_hash) = 32),
  constraint app_session_token_state_check
    check (state in ('current', 'grace', 'retired')),
  constraint app_session_token_validity_check
    check (
      (state = 'current' and valid_until is null)
      or (
        state in ('grace', 'retired')
        and valid_until is not null
        and valid_until >= created_at
      )
    )
);

create unique index app_session_token_one_current_idx
  on app_private.app_session_token (session_id)
  where state = 'current';

create unique index app_session_token_one_grace_idx
  on app_private.app_session_token (session_id)
  where state = 'grace';

create index app_session_token_session_idx
  on app_private.app_session_token (session_id, created_at);

create table app_private.login_throttle (
  scope             text not null,
  fingerprint       bytea not null,
  window_started_at timestamptz not null,
  attempt_count     integer not null,
  blocked_until     timestamptz,
  updated_at        timestamptz not null,
  primary key (scope, fingerprint),
  constraint login_throttle_scope_check
    check (scope in ('account', 'network')),
  constraint login_throttle_fingerprint_check
    check (octet_length(fingerprint) = 32),
  constraint login_throttle_attempt_count_check
    check (attempt_count >= 0),
  constraint login_throttle_time_order_check
    check (
      updated_at >= window_started_at
      and (blocked_until is null or blocked_until > window_started_at)
    )
);

create index login_throttle_updated_at_idx
  on app_private.login_throttle (updated_at, scope, fingerprint);

create function app_private.require_session_digest(p_digest bytea)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  if p_digest is null or pg_catalog.octet_length(p_digest) <> 32 then
    raise exception using
      errcode = '22023',
      message = 'invalid session digest';
  end if;
end;
$$;

create function app_private.require_session_request_id(p_request_id uuid)
returns void
language plpgsql
immutable
security invoker
set search_path = pg_catalog
as $$
begin
  if p_request_id is null then
    raise exception using
      errcode = '22023',
      message = 'session request ID is required';
  end if;
end;
$$;

create function app_private.create_app_session(
  p_principal_id uuid,
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now             timestamptz;
  v_principal_status text;
  v_session_id      uuid;
  v_idle_expires_at timestamptz;
  v_absolute_expires_at timestamptz;
  v_rotate_after    timestamptz;
begin
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_request_id(p_request_id);

  select principal.status
  into v_principal_status
  from app_private.principal principal
  where principal.id = p_principal_id
  for share;

  if v_principal_status is distinct from 'active' then
    raise exception using
      errcode = '55000',
      message = 'principal is not active';
  end if;

  -- Sample only after the Principal lock. A concurrent suspension or session
  -- admission must have one unambiguous serialization order.
  v_now := pg_catalog.clock_timestamp();

  v_idle_expires_at := v_now + interval '30 minutes';
  v_absolute_expires_at := v_now + interval '8 hours';
  v_rotate_after := v_now + interval '15 minutes';

  insert into app_private.app_session (
    principal_id,
    created_at,
    last_seen_at,
    idle_expires_at,
    absolute_expires_at,
    rotate_after
  ) values (
    p_principal_id,
    v_now,
    v_now,
    v_idle_expires_at,
    v_absolute_expires_at,
    v_rotate_after
  ) returning id into v_session_id;

  begin
    insert into app_private.app_session_token (
      token_hash,
      session_id,
      state,
      created_at,
      valid_until
    ) values (
      p_token_hash,
      v_session_id,
      'current',
      v_now,
      null
    );
  exception
    when unique_violation then
      -- PostgreSQL's native unique-violation DETAIL includes the conflicting
      -- bytea value. Preserve the stable SQLSTATE but replace every field that
      -- could expose a credential digest to RPC logs or error telemetry.
      raise exception using
        errcode = '23505',
        message = 'session digest already exists';
  end;

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
    'principal',
    p_principal_id,
    'session.created',
    'session',
    v_session_id::text,
    p_request_id,
    '{}'::jsonb
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'sessionId', v_session_id,
    'principalId', p_principal_id,
    'idleExpiresAt', v_idle_expires_at,
    'absoluteExpiresAt', v_absolute_expires_at,
    'rotateAfter', v_rotate_after
  );
exception
  when unique_violation then
    -- Keep the token-collision contract stable without retaining PostgreSQL's
    -- native DETAIL, which includes the conflicting digest.
    raise exception using
      errcode = '23505',
      message = 'session digest already exists';
  when integrity_constraint_violation then
    -- Preserve the useful constraint SQLSTATE only. Replacing the complete
    -- diagnostic prevents a future token-bearing row or trigger from placing
    -- a digest in MESSAGE, DETAIL, HINT, or the original statement CONTEXT.
    raise exception using
      errcode = sqlstate,
      message = 'session state constraint violation';
end;
$$;

create function app_private.use_app_session(
  p_token_hash bytea,
  p_replacement_hash bytea,
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
  v_session          app_private.app_session%rowtype;
  v_principal_status text;
  v_token_state      text;
  v_token_valid_until timestamptz;
  v_status           text;
begin
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_digest(p_replacement_hash);
  perform app_private.require_session_request_id(p_request_id);
  if p_token_hash = p_replacement_hash then
    raise exception using
      errcode = '22023',
      message = 'replacement session digest must be distinct';
  end if;

  -- Resolve the family and Principal without a lock. The Principal SHARE lock
  -- is acquired before the family lock: concurrent requests for the same
  -- Principal remain compatible, while status/admin writers serialize before
  -- families and the audit actor FK never introduces a reverse lock edge.
  select token.session_id, session_row.principal_id
  into v_session_id, v_principal_id
  from app_private.app_session_token token
  join app_private.app_session session_row on session_row.id = token.session_id
  where token.token_hash = p_token_hash;

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

  if not found then
    return '{"ok":false}'::jsonb;
  end if;

  -- A waiter must evaluate expiry and renewal against the time at which it
  -- actually owns the family lock, not the transaction or pre-wait time.
  v_now := pg_catalog.clock_timestamp();

  select token.state, token.valid_until
  into v_token_state, v_token_valid_until
  from app_private.app_session_token token
  where token.token_hash = p_token_hash
    and token.session_id = v_session_id;

  if not found or v_session.revoked_at is not null then
    return '{"ok":false}'::jsonb;
  end if;

  if v_now >= v_session.idle_expires_at
    or v_now >= v_session.absolute_expires_at
  then
    return '{"ok":false}'::jsonb;
  end if;

  if v_principal_status <> 'active' then
    update app_private.app_session
    set revoked_at = v_now,
        revoke_reason = 'principal_status'
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
      pg_catalog.jsonb_build_object('reason', 'principal_status')
    );

    return '{"ok":false}'::jsonb;
  end if;

  if v_token_state = 'retired'
    or (v_token_state = 'grace' and v_now >= v_token_valid_until)
  then
    update app_private.app_session
    set revoked_at = v_now,
        revoke_reason = 'token_reuse'
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
      pg_catalog.jsonb_build_object('reason', 'token_reuse')
    );

    return '{"ok":false}'::jsonb;
  end if;

  v_session.last_seen_at := v_now;
  v_session.idle_expires_at := least(
    v_now + interval '30 minutes',
    v_session.absolute_expires_at
  );

  if v_token_state = 'current' and v_now >= v_session.rotate_after then
    update app_private.app_session_token
    set state = 'retired'
    where session_id = v_session_id
      and state = 'grace';

    update app_private.app_session_token
    set state = 'grace',
        valid_until = least(
          v_now + interval '60 seconds',
          v_session.absolute_expires_at
        )
    where token_hash = p_token_hash
      and session_id = v_session_id
      and state = 'current';

    begin
      insert into app_private.app_session_token (
        token_hash,
        session_id,
        state,
        created_at,
        valid_until
      ) values (
        p_replacement_hash,
        v_session_id,
        'current',
        v_now,
        null
      );
    exception
      when unique_violation then
        raise exception using
          errcode = '23505',
          message = 'session digest already exists';
    end;

    v_session.rotate_after := least(
      v_now + interval '15 minutes',
      v_session.absolute_expires_at
    );
    v_session.rotation_count := v_session.rotation_count + 1;

    update app_private.app_session
    set last_seen_at = v_session.last_seen_at,
        idle_expires_at = v_session.idle_expires_at,
        rotate_after = v_session.rotate_after,
        rotation_count = v_session.rotation_count
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
      'principal',
      v_session.principal_id,
      'session.rotated',
      'session',
      v_session_id::text,
      p_request_id,
      pg_catalog.jsonb_build_object('rotation', v_session.rotation_count)
    );

    v_status := 'rotated';
  else
    update app_private.app_session
    set last_seen_at = v_session.last_seen_at,
        idle_expires_at = v_session.idle_expires_at
    where id = v_session_id;
    v_status := case when v_token_state = 'grace' then 'grace' else 'active' end;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'status', v_status,
    'sessionId', v_session_id,
    'principalId', v_session.principal_id,
    'idleExpiresAt', v_session.idle_expires_at,
    'absoluteExpiresAt', v_session.absolute_expires_at,
    'rotateAfter', v_session.rotate_after
  );
exception
  when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'session digest already exists';
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'session state constraint violation';
end;
$$;

create function app_private.logout_app_session(
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now          timestamptz;
  v_session_id   uuid;
  v_principal_id uuid;
  v_revoked_at   timestamptz;
begin
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_request_id(p_request_id);

  -- Resolve without a lock, then take the Principal SHARE lock before the
  -- family. Besides freezing the audit actor row, this keeps the explicit
  -- lifecycle locks ordered ahead of the audit foreign-key check.
  select token.session_id, session_row.principal_id
  into v_session_id, v_principal_id
  from app_private.app_session_token token
  join app_private.app_session session_row on session_row.id = token.session_id
  where token.token_hash = p_token_hash;

  if not found then
    return '{"ok":true,"revoked":false}'::jsonb;
  end if;

  perform principal.id
  from app_private.principal principal
  where principal.id = v_principal_id
  for share;

  if not found then
    return '{"ok":true,"revoked":false}'::jsonb;
  end if;

  select session_row.principal_id, session_row.revoked_at
  into v_principal_id, v_revoked_at
  from app_private.app_session session_row
  where session_row.id = v_session_id
    and session_row.principal_id = v_principal_id
  for update;

  if not found
    or not exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = p_token_hash
        and token.session_id = v_session_id
    )
    or v_revoked_at is not null
  then
    return '{"ok":true,"revoked":false}'::jsonb;
  end if;

  v_now := pg_catalog.clock_timestamp();
  update app_private.app_session
  set revoked_at = v_now,
      revoke_reason = 'logout'
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
    'principal',
    v_principal_id,
    'session.revoked',
    'session',
    v_session_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object('reason', 'logout')
  );

  return pg_catalog.jsonb_build_object('ok', true, 'revoked', true);
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'session state constraint violation';
end;
$$;

create function app_private.revoke_app_session(
  p_session_id uuid,
  p_actor_principal_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now                 timestamptz;
  v_target_principal_id uuid;
  v_actor_status        text;
  v_revoked_at          timestamptz;
begin
  perform app_private.require_session_request_id(p_request_id);
  if p_session_id is null
    or p_reason is null
    or p_reason not in ('administrator', 'security_event')
    or (p_reason = 'administrator' and p_actor_principal_id is null)
  then
    raise exception using
      errcode = '22023',
      message = 'invalid administrative session revocation';
  end if;

  -- Resolve the target without a lock, then acquire every involved Principal
  -- row in UUID order before locking the family. This freezes administrator
  -- eligibility for the whole mutation and gives cross-Principal revocations
  -- one global, deadlock-safe order. The family relationship is re-read after
  -- its lock, so a stale initial lookup cannot authorize a mutation.
  select session_row.principal_id
  into v_target_principal_id
  from app_private.app_session session_row
  where session_row.id = p_session_id;

  perform principal.id
  from app_private.principal principal
  where principal.id = v_target_principal_id
    or principal.id = p_actor_principal_id
  order by principal.id
  for update;

  if p_actor_principal_id is not null then
    select principal.status
    into v_actor_status
    from app_private.principal principal
    where principal.id = p_actor_principal_id;

    if not found
      or (p_reason = 'administrator' and v_actor_status <> 'active')
    then
      raise exception using
        errcode = '22023',
        message = 'invalid session revocation actor';
    end if;
  end if;

  if v_target_principal_id is null then
    return '{"ok":true,"revoked":false}'::jsonb;
  end if;

  select session_row.revoked_at
  into v_revoked_at
  from app_private.app_session session_row
  where session_row.id = p_session_id
    and session_row.principal_id = v_target_principal_id
  for update;

  if not found or v_revoked_at is not null then
    return '{"ok":true,"revoked":false}'::jsonb;
  end if;

  v_now := pg_catalog.clock_timestamp();
  update app_private.app_session
  set revoked_at = v_now,
      revoke_reason = p_reason
  where id = p_session_id;

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
    case when p_actor_principal_id is null then 'system' else 'principal' end,
    p_actor_principal_id,
    'session.revoked',
    'session',
    p_session_id::text,
    p_request_id,
    pg_catalog.jsonb_build_object('reason', p_reason)
  );

  return pg_catalog.jsonb_build_object('ok', true, 'revoked', true);
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'session state constraint violation';
end;
$$;

create function app_private.revoke_principal_sessions(
  p_principal_id uuid,
  p_except_session_id uuid,
  p_actor_principal_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now             timestamptz;
  v_count           integer;
  v_principal_status text;
  v_actor_status    text;
begin
  perform app_private.require_session_request_id(p_request_id);
  if p_principal_id is null
    or p_reason is null
    or p_reason not in ('administrator', 'security_event', 'principal_status')
    or (p_reason = 'administrator' and p_actor_principal_id is null)
    or (p_reason = 'principal_status' and p_actor_principal_id is not null)
  then
    raise exception using
      errcode = '22023',
      message = 'invalid principal session revocation reason';
  end if;

  -- Admission, status changes, and revocation all acquire every involved
  -- Principal in UUID order. In particular, the actor is frozen as active for
  -- the complete administrative mutation and crossed target/actor operations
  -- cannot deadlock. Families follow in UUID order below.
  perform principal.id
  from app_private.principal principal
  where principal.id = p_principal_id
    or principal.id = p_actor_principal_id
  order by principal.id
  for update;

  select principal.status
  into v_principal_status
  from app_private.principal principal
  where principal.id = p_principal_id;

  if not found
    or (p_reason = 'principal_status' and v_principal_status = 'active')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid principal session revocation target';
  end if;

  if p_actor_principal_id is not null then
    select principal.status
    into v_actor_status
    from app_private.principal principal
    where principal.id = p_actor_principal_id;

    if not found
      or (p_reason = 'administrator' and v_actor_status <> 'active')
    then
      raise exception using
        errcode = '22023',
        message = 'invalid principal session revocation actor';
    end if;
  end if;

  if p_except_session_id is not null
    and not exists (
      select 1
      from app_private.app_session session_row
      where session_row.id = p_except_session_id
        and session_row.principal_id = p_principal_id
    )
  then
    raise exception using
      errcode = '22023',
      message = 'excluded session does not belong to principal';
  end if;

  perform session_row.id
  from app_private.app_session session_row
  where session_row.principal_id = p_principal_id
    and session_row.revoked_at is null
    and session_row.id is distinct from p_except_session_id
  order by session_row.id
  for update;

  v_now := pg_catalog.clock_timestamp();
  with revoked as (
    update app_private.app_session
    set revoked_at = v_now,
        revoke_reason = p_reason
    where principal_id = p_principal_id
      and revoked_at is null
      and id is distinct from p_except_session_id
    returning id
  )
  insert into app_private.audit_event (
      occurred_at,
      actor_type,
      actor_principal_id,
      action,
      entity_type,
      entity_id,
      request_id,
      metadata
    )
    select
      v_now,
      case when p_actor_principal_id is null then 'system' else 'principal' end,
      p_actor_principal_id,
      'session.revoked',
      'session',
      revoked.id::text,
      p_request_id,
      pg_catalog.jsonb_build_object('reason', p_reason)
    from revoked;
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'revoked', v_count);
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'session state constraint violation';
end;
$$;

create function app_private.consume_login_throttle_dimension(
  p_scope text,
  p_fingerprint bytea,
  p_limit integer
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_row app_private.login_throttle%rowtype;
  v_now timestamptz;
  v_seed_now timestamptz;
  v_retry_after integer := 0;
begin
  if p_scope is null
    or p_scope not in ('account', 'network')
    or p_fingerprint is null
    or pg_catalog.octet_length(p_fingerprint) <> 32
    or p_limit is null
    or p_limit <= 0
  then
    raise exception using
      errcode = '22023',
      message = 'invalid login throttle dimension';
  end if;

  -- DO NOTHING does not retain a lock on an existing conflicting row. Account
  -- clear or bounded cleanup can therefore delete it before the following
  -- SELECT. Retry the insert/lock pair until this transaction owns a stable
  -- row; after FOR UPDATE, deletion must serialize behind this attempt.
  loop
    v_seed_now := pg_catalog.clock_timestamp();
    insert into app_private.login_throttle (
      scope,
      fingerprint,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    ) values (
      p_scope,
      p_fingerprint,
      v_seed_now,
      0,
      null,
      v_seed_now
    ) on conflict (scope, fingerprint) do nothing;

    select throttle.*
    into v_row
    from app_private.login_throttle throttle
    where throttle.scope = p_scope
      and throttle.fingerprint = p_fingerprint
    for update;

    exit when found;
  end loop;

  -- Sample only after acquiring this dimension's row lock. A waiter must not
  -- overwrite newer timestamps or return a retry interval based on stale time.
  v_now := pg_catalog.clock_timestamp();

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    update app_private.login_throttle
    set updated_at = v_now
    where scope = p_scope and fingerprint = p_fingerprint;

    return greatest(
      1,
      ceil(extract(epoch from (v_row.blocked_until - v_now)))::integer
    );
  end if;

  if v_row.window_started_at <= v_now - interval '15 minutes' then
    v_row.window_started_at := v_now;
    v_row.attempt_count := 0;
    v_row.blocked_until := null;
  end if;

  v_row.attempt_count := v_row.attempt_count + 1;
  if v_row.attempt_count > p_limit then
    v_row.blocked_until := v_now + interval '15 minutes';
    v_retry_after := 15 * 60;
  end if;

  update app_private.login_throttle
  set window_started_at = v_row.window_started_at,
      attempt_count = v_row.attempt_count,
      blocked_until = v_row.blocked_until,
      updated_at = v_now
  where scope = p_scope and fingerprint = p_fingerprint;

  return v_retry_after;
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'login throttle state constraint violation';
end;
$$;

create function app_private.consume_login_attempt(
  p_account_fingerprint bytea,
  p_network_fingerprint bytea
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_account_retry integer;
  v_network_retry integer;
  v_retry_after integer;
begin
  if p_account_fingerprint is null
    or pg_catalog.octet_length(p_account_fingerprint) <> 32
    or p_network_fingerprint is null
    or pg_catalog.octet_length(p_network_fingerprint) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'invalid login fingerprints';
  end if;

  -- Always lock account before network. This is the global lock order for
  -- overlapping login dimensions and prevents cross-request deadlocks.
  v_account_retry := app_private.consume_login_throttle_dimension(
    'account', p_account_fingerprint, 5
  );
  v_network_retry := app_private.consume_login_throttle_dimension(
    'network', p_network_fingerprint, 30
  );
  v_retry_after := greatest(v_account_retry, v_network_retry);

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'allowed', v_retry_after = 0,
    'retryAfterSeconds', v_retry_after
  );
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'login throttle state constraint violation';
end;
$$;

create function app_private.clear_login_account_throttle(
  p_account_fingerprint bytea
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_count integer;
begin
  if p_account_fingerprint is null
    or pg_catalog.octet_length(p_account_fingerprint) <> 32
  then
    raise exception using
      errcode = '22023',
      message = 'invalid login account fingerprint';
  end if;

  delete from app_private.login_throttle
  where scope = 'account' and fingerprint = p_account_fingerprint;
  get diagnostics v_count = row_count;

  return pg_catalog.jsonb_build_object('ok', true, 'cleared', v_count > 0);
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'login throttle state constraint violation';
end;
$$;

create function app_private.cleanup_app_sessions(
  p_limit integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_now timestamptz;
  v_session_count integer;
  v_throttle_count integer;
begin
  perform app_private.require_session_request_id(p_request_id);
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'session cleanup limit must be between 1 and 1000';
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Retain terminal hashes for 24 hours so late predecessor reuse can still be
  -- detected. Each worker claims a deterministic bounded batch and skips rows
  -- already owned by another cleanup worker.
  with candidates as materialized (
    select
      session_row.id,
      session_row.revoked_at,
      session_row.idle_expires_at,
      session_row.absolute_expires_at
    from app_private.app_session session_row
    where (
        session_row.revoked_at is not null
        and session_row.revoked_at <= v_now - interval '24 hours'
      ) or (
        session_row.revoked_at is null
        and least(
          session_row.idle_expires_at,
          session_row.absolute_expires_at
        ) <= v_now - interval '24 hours'
      )
    order by coalesce(
      session_row.revoked_at,
      least(session_row.idle_expires_at, session_row.absolute_expires_at)
    ), session_row.id
    for update skip locked
    limit p_limit
  ), expired_audit as (
    insert into app_private.audit_event (
      occurred_at,
      actor_type,
      actor_principal_id,
      action,
      entity_type,
      entity_id,
      request_id,
      metadata
    )
    select
      v_now,
      'system',
      null,
      'session.expired',
      'session',
      candidates.id::text,
      p_request_id,
      pg_catalog.jsonb_build_object(
        'reason',
        case
          when candidates.absolute_expires_at <= candidates.idle_expires_at
            then 'absolute_timeout'
          else 'idle_timeout'
        end
      )
    from candidates
    where candidates.revoked_at is null
    returning id
  ), deleted as (
    delete from app_private.app_session session_row
    using candidates
    where session_row.id = candidates.id
    returning session_row.id
  )
  select count(*)::integer
  into v_session_count
  from deleted;

  with candidates as materialized (
    select throttle.scope, throttle.fingerprint
    from app_private.login_throttle throttle
    where throttle.updated_at <= v_now - interval '24 hours'
      and (throttle.blocked_until is null or throttle.blocked_until <= v_now)
    order by throttle.updated_at, throttle.scope, throttle.fingerprint
    for update skip locked
    limit p_limit
  ), deleted as (
    delete from app_private.login_throttle throttle
    using candidates
    where throttle.scope = candidates.scope
      and throttle.fingerprint = candidates.fingerprint
    returning throttle.scope
  )
  select count(*)::integer
  into v_throttle_count
  from deleted;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'sessionsDeleted', v_session_count,
    'throttlesDeleted', v_throttle_count
  );
exception
  when integrity_constraint_violation then
    raise exception using
      errcode = sqlstate,
      message = 'session cleanup state constraint violation';
end;
$$;

create function public.create_app_session(
  p_principal_id uuid,
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.create_app_session($1, $2, $3);
end;
$$;

create function public.use_app_session(
  p_token_hash bytea,
  p_replacement_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.use_app_session($1, $2, $3);
end;
$$;

create function public.logout_app_session(
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.logout_app_session($1, $2);
end;
$$;

create function public.revoke_app_session(
  p_session_id uuid,
  p_actor_principal_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.revoke_app_session($1, $2, $3, $4);
end;
$$;

create function public.revoke_principal_sessions(
  p_principal_id uuid,
  p_except_session_id uuid,
  p_actor_principal_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.revoke_principal_sessions($1, $2, $3, $4, $5);
end;
$$;

create function public.consume_login_attempt(
  p_account_fingerprint bytea,
  p_network_fingerprint bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.consume_login_attempt($1, $2);
end;
$$;

create function public.clear_login_account_throttle(
  p_account_fingerprint bytea
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.clear_login_account_throttle($1);
end;
$$;

-- Keep this wrapper last among 019 objects so a pre-existing conflict proves
-- that the migration and ledger write roll back without partial foundations.
create function public.cleanup_app_sessions(
  p_limit integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.cleanup_app_sessions($1, $2);
end;
$$;

alter table app_private.app_session enable row level security;
alter table app_private.app_session_token enable row level security;
alter table app_private.login_throttle enable row level security;

revoke all on table
  app_private.app_session,
  app_private.app_session_token,
  app_private.login_throttle
from public, anon, authenticated;

revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.create_app_session(uuid, bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.use_app_session(bytea, bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.logout_app_session(bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_app_session(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_principal_sessions(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.consume_login_attempt(bytea, bytea)
  from public, anon, authenticated;
revoke all on function public.clear_login_account_throttle(bytea)
  from public, anon, authenticated;
revoke all on function public.cleanup_app_sessions(integer, uuid)
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
        'grant execute on function public.create_app_session(uuid,bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.use_app_session(bytea,bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.logout_app_session(bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.revoke_app_session(uuid,uuid,text,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.consume_login_attempt(bytea,bytea) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.clear_login_account_throttle(bytea) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.cleanup_app_sessions(integer,uuid) to %I',
        v_role
      );
    end if;
  end loop;
end
$acl$;

comment on table app_private.app_session is
  'Private server-side application session state with idle, absolute, rotation, and revocation boundaries.';
comment on table app_private.app_session_token is
  'SHA-256 session-token digests and rotation lineage only; raw session secrets are never persisted.';
comment on table app_private.login_throttle is
  'Short-lived keyed account and network fingerprints for atomic application-login throttling.';
comment on function public.create_app_session(uuid, bytea, uuid) is
  'Trusted-service session creation; accepts a 32-byte digest and returns no credential material.';
comment on function public.use_app_session(bytea, bytea, uuid) is
  'Trusted-service atomic validation, idle touch, rotation, grace, and replay-detection boundary.';
comment on function public.logout_app_session(bytea, uuid) is
  'Trusted-service idempotent token-based logout boundary.';
comment on function public.revoke_app_session(uuid, uuid, text, uuid) is
  'Trusted-service idempotent administrative single-session revocation boundary.';
comment on function public.revoke_principal_sessions(uuid, uuid, uuid, text, uuid) is
  'Trusted-service bulk principal-session revocation boundary.';
comment on function public.consume_login_attempt(bytea, bytea) is
  'Trusted-service atomic account and network login-throttle reservation.';
comment on function public.clear_login_account_throttle(bytea) is
  'Trusted-service successful-login account-throttle reset; network quota is retained.';
comment on function public.cleanup_app_sessions(integer, uuid) is
  'Trusted-service bounded cleanup for 24-hour terminal-session and login-throttle retention.';

notify pgrst, 'reload schema';
