\set ON_ERROR_STOP on

begin;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

create temporary table session_foundation_test_response (
  label   text primary key,
  payload jsonb not null
) on commit drop;

-- Freeze the owner-facing and guarded RPC contracts before exercising state.
do $test$
declare
  v_signature text;
  v_table     text;
begin
  foreach v_signature in array array[
    'app_private.create_app_session(uuid,bytea,uuid)',
    'app_private.use_app_session(bytea,bytea,uuid)',
    'app_private.logout_app_session(bytea,uuid)',
    'app_private.revoke_app_session(uuid,uuid,text,uuid)',
    'app_private.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)',
    'app_private.consume_login_attempt(bytea,bytea)',
    'app_private.clear_login_account_throttle(bytea)',
    'app_private.cleanup_app_sessions(integer,uuid)',
    'public.create_app_session(uuid,bytea,uuid)',
    'public.use_app_session(bytea,bytea,uuid)',
    'public.logout_app_session(bytea,uuid)',
    'public.revoke_app_session(uuid,uuid,text,uuid)',
    'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)',
    'public.consume_login_attempt(bytea,bytea)',
    'public.clear_login_account_throttle(bytea)',
    'public.cleanup_app_sessions(integer,uuid)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'session foundation routine is missing: %', v_signature;
    end if;
  end loop;

  if exists (
    select 1
    from (values
      ('create_app_session', array['p_principal_id', 'p_token_hash', 'p_request_id']::text[]),
      ('use_app_session', array['p_token_hash', 'p_replacement_hash', 'p_request_id']::text[]),
      ('logout_app_session', array['p_token_hash', 'p_request_id']::text[]),
      ('revoke_app_session', array[
        'p_session_id', 'p_actor_principal_id', 'p_reason', 'p_request_id'
      ]::text[]),
      ('revoke_principal_sessions', array[
        'p_principal_id', 'p_except_session_id', 'p_actor_principal_id',
        'p_reason', 'p_request_id'
      ]::text[]),
      ('consume_login_attempt', array[
        'p_account_fingerprint', 'p_network_fingerprint'
      ]::text[]),
      ('clear_login_account_throttle', array['p_account_fingerprint']::text[]),
      ('cleanup_app_sessions', array['p_limit', 'p_request_id']::text[])
    ) expected(proname, argument_names)
    join pg_catalog.pg_proc routine on routine.proname = expected.proname
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proargnames is distinct from expected.argument_names
  ) then
    raise exception 'a public session wrapper has unstable PostgREST argument names';
  end if;

  foreach v_table in array array[
    'app_session',
    'app_session_token',
    'login_throttle'
  ] loop
    if pg_catalog.to_regclass('app_private.' || v_table) is null then
      raise exception 'session foundation table is missing: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_private'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'session foundation table does not enable RLS: %', v_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'app_private'
        and policy.tablename = v_table
    ) then
      raise exception 'private session table unexpectedly has an RLS policy: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'app_session_token'
      and column_name = 'token_hash'
      and data_type = 'bytea'
      and is_nullable = 'NO'
  ) then
    raise exception 'session tokens are not represented by a required bytea digest';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name in ('app_session', 'app_session_token')
      and column_name ~ '(raw|secret|credential|token_value|token_text)'
  ) then
    raise exception 'session storage contains a raw credential-shaped column';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid =
          'app_private.app_session_token'::pg_catalog.regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
          like '%octet_length(token_hash) = 32%'
  ) then
    raise exception 'session token storage does not enforce a 32-byte digest';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid =
          'app_private.login_throttle'::pg_catalog.regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
          like '%octet_length(fingerprint) = 32%'
  ) then
    raise exception 'login throttle storage does not enforce keyed 32-byte fingerprints';
  end if;

  if exists (
    with expected(
      table_name,
      column_name,
      ordinal_position,
      udt_name,
      nullable,
      column_default
    ) as (values
      ('app_session', 'id', 1, 'uuid', false, 'gen_random_uuid()'),
      ('app_session', 'principal_id', 2, 'uuid', false, ''),
      ('app_session', 'created_at', 3, 'timestamptz', false, ''),
      ('app_session', 'last_seen_at', 4, 'timestamptz', false, ''),
      ('app_session', 'idle_expires_at', 5, 'timestamptz', false, ''),
      ('app_session', 'absolute_expires_at', 6, 'timestamptz', false, ''),
      ('app_session', 'rotate_after', 7, 'timestamptz', false, ''),
      ('app_session', 'rotation_count', 8, 'int4', false, '0'),
      ('app_session', 'revoked_at', 9, 'timestamptz', true, ''),
      ('app_session', 'revoke_reason', 10, 'text', true, ''),
      ('app_session_token', 'token_hash', 1, 'bytea', false, ''),
      ('app_session_token', 'session_id', 2, 'uuid', false, ''),
      ('app_session_token', 'state', 3, 'text', false, ''),
      ('app_session_token', 'created_at', 4, 'timestamptz', false, ''),
      ('app_session_token', 'valid_until', 5, 'timestamptz', true, ''),
      ('login_throttle', 'scope', 1, 'text', false, ''),
      ('login_throttle', 'fingerprint', 2, 'bytea', false, ''),
      ('login_throttle', 'window_started_at', 3, 'timestamptz', false, ''),
      ('login_throttle', 'attempt_count', 4, 'int4', false, ''),
      ('login_throttle', 'blocked_until', 5, 'timestamptz', true, ''),
      ('login_throttle', 'updated_at', 6, 'timestamptz', false, '')
    ), actual as (
      select
        column_definition.table_name,
        column_definition.column_name,
        column_definition.ordinal_position,
        column_definition.udt_name,
        column_definition.is_nullable = 'YES',
        coalesce(column_definition.column_default, '')
      from information_schema.columns column_definition
      where column_definition.table_schema = 'app_private'
        and column_definition.table_name in (
          'app_session',
          'app_session_token',
          'login_throttle'
        )
    ), differences as (
      (select * from expected except select * from actual)
      union all
      (select * from actual except select * from expected)
    )
    select 1 from differences
  ) then
    raise exception 'session foundation columns/defaults/nullability drifted';
  end if;

  if exists (
    with expected(relation_name, constraint_name, constraint_type) as (values
      ('app_session', 'app_session_pkey', 'p'),
      ('app_session', 'app_session_principal_id_fkey', 'f'),
      ('app_session', 'app_session_time_order_check', 'c'),
      ('app_session', 'app_session_rotation_count_check', 'c'),
      ('app_session', 'app_session_revocation_check', 'c'),
      ('app_session_token', 'app_session_token_pkey', 'p'),
      ('app_session_token', 'app_session_token_session_id_fkey', 'f'),
      ('app_session_token', 'app_session_token_hash_check', 'c'),
      ('app_session_token', 'app_session_token_state_check', 'c'),
      ('app_session_token', 'app_session_token_validity_check', 'c'),
      ('login_throttle', 'login_throttle_pkey', 'p'),
      ('login_throttle', 'login_throttle_scope_check', 'c'),
      ('login_throttle', 'login_throttle_fingerprint_check', 'c'),
      ('login_throttle', 'login_throttle_attempt_count_check', 'c'),
      ('login_throttle', 'login_throttle_time_order_check', 'c')
    ), actual as (
      select relation.relname, constraint_definition.conname,
        constraint_definition.contype::text
      from pg_catalog.pg_constraint constraint_definition
      join pg_catalog.pg_class relation
        on relation.oid = constraint_definition.conrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_private'
        and relation.relname in (
          'app_session',
          'app_session_token',
          'login_throttle'
        )
    ), differences as (
      (select * from expected except select * from actual)
      union all
      (select * from actual except select * from expected)
    )
    select 1 from differences
  ) then
    raise exception 'session foundation primary/FK/check constraint set drifted';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_definition
      where constraint_definition.conname = 'app_session_principal_id_fkey'
        and constraint_definition.conrelid =
            'app_private.app_session'::pg_catalog.regclass
        and constraint_definition.confrelid =
            'app_private.principal'::pg_catalog.regclass
        and constraint_definition.confdeltype = 'r'
    )
    or not exists (
      select 1
      from pg_catalog.pg_constraint constraint_definition
      where constraint_definition.conname = 'app_session_token_session_id_fkey'
        and constraint_definition.conrelid =
            'app_private.app_session_token'::pg_catalog.regclass
        and constraint_definition.confrelid =
            'app_private.app_session'::pg_catalog.regclass
        and constraint_definition.confdeltype = 'c'
    )
  then
    raise exception 'session foundation foreign-key target/delete action drifted';
  end if;

  if exists (
    with expected(index_name) as (values
      ('app_session_pkey'),
      ('app_session_principal_active_idx'),
      ('app_session_active_expiry_idx'),
      ('app_session_revoked_at_idx'),
      ('app_session_token_pkey'),
      ('app_session_token_one_current_idx'),
      ('app_session_token_one_grace_idx'),
      ('app_session_token_session_idx'),
      ('login_throttle_pkey'),
      ('login_throttle_updated_at_idx')
    ), actual as (
      select index_relation.relname
      from pg_catalog.pg_index index_definition
      join pg_catalog.pg_class table_relation
        on table_relation.oid = index_definition.indrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = table_relation.relnamespace
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_definition.indexrelid
      where namespace.nspname = 'app_private'
        and table_relation.relname in (
          'app_session',
          'app_session_token',
          'login_throttle'
        )
    ), differences as (
      (select * from expected except select * from actual)
      union all
      (select * from actual except select * from expected)
    )
    select 1 from differences
  ) then
    raise exception 'session foundation index set drifted';
  end if;

  if exists (
    select 1
    from (values
      ('app_session_principal_active_idx', false, true, false),
      ('app_session_active_expiry_idx', false, true, true),
      ('app_session_revoked_at_idx', false, true, false),
      ('app_session_token_one_current_idx', true, true, false),
      ('app_session_token_one_grace_idx', true, true, false),
      ('app_session_token_session_idx', false, false, false),
      ('login_throttle_updated_at_idx', false, false, false)
    ) expected(index_name, is_unique, is_partial, is_expression)
    join pg_catalog.pg_class index_relation
      on index_relation.relname = expected.index_name
    join pg_catalog.pg_index index_definition
      on index_definition.indexrelid = index_relation.oid
    where index_definition.indisunique is distinct from expected.is_unique
      or (index_definition.indpred is not null) is distinct from expected.is_partial
      or (index_definition.indexprs is not null)
         is distinct from expected.is_expression
  ) then
    raise exception 'session foundation index uniqueness/predicate/expression drifted';
  end if;

  if exists (
    select 1
    from (values
      ('app_private.app_session'::pg_catalog.regclass,
       'Private server-side application session state with idle, absolute, rotation, and revocation boundaries.'),
      ('app_private.app_session_token'::pg_catalog.regclass,
       'SHA-256 session-token digests and rotation lineage only; raw session secrets are never persisted.'),
      ('app_private.login_throttle'::pg_catalog.regclass,
       'Short-lived keyed account and network fingerprints for atomic application-login throttling.')
    ) expected(relation_id, expected_comment)
    where pg_catalog.obj_description(expected.relation_id, 'pg_class')
      is distinct from expected.expected_comment
  ) then
    raise exception 'session foundation table comments drifted';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'create_app_session',
        'use_app_session',
        'logout_app_session',
        'revoke_app_session',
        'revoke_principal_sessions',
        'consume_login_attempt',
        'clear_login_account_throttle',
        'cleanup_app_sessions'
      )
      and pg_catalog.obj_description(routine.oid, 'pg_proc') is null
  ) then
    raise exception 'a public session wrapper is missing its contract comment';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'app_private'
      and routine.proname in (
        'create_app_session',
        'use_app_session',
        'logout_app_session',
        'revoke_app_session',
        'revoke_principal_sessions',
        'consume_login_attempt',
        'clear_login_account_throttle',
        'cleanup_app_sessions'
      )
      and routine.prosecdef
  ) then
    raise exception 'a private session implementation uses definer rights';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'create_app_session',
        'use_app_session',
        'logout_app_session',
        'revoke_app_session',
        'revoke_principal_sessions',
        'consume_login_attempt',
        'clear_login_account_throttle',
        'cleanup_app_sessions'
      )
      and (
        not routine.prosecdef
        or routine.prosrc not like '%app_private.require_rpc_role%'
        or not (
          'search_path=pg_catalog, app_private' = any(
            coalesce(routine.proconfig, array[]::text[])
          )
        )
      )
  ) then
    raise exception 'a public session wrapper is not claims-guarded and path-pinned';
  end if;
end
$test$;

-- Stable test principals. The outer rollback makes these fixtures repeatable.
do $test$
declare
  v_created_at timestamptz := pg_catalog.clock_timestamp() - interval '1 day';
begin
  insert into app_private.principal (
    id,
    status,
    created_at,
    updated_at,
    deleted_at
  ) values
    ('01900000-0000-4000-8000-000000000001', 'active',    v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000002', 'suspended', v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000003', 'deleted',   v_created_at, v_created_at,
      pg_catalog.clock_timestamp()),
    ('01900000-0000-4000-8000-000000000004', 'active',    v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000005', 'active',    v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000006', 'active',    v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000007', 'active',    v_created_at, v_created_at, null),
    ('01900000-0000-4000-8000-000000000008', 'active',    v_created_at, v_created_at, null);
end
$test$;

-- Creation admits only active principals, persists only the digest, and is
-- atomic on duplicate or malformed input.
do $test$
declare
  v_active          constant uuid := '01900000-0000-4000-8000-000000000001';
  v_suspended       constant uuid := '01900000-0000-4000-8000-000000000002';
  v_deleted         constant uuid := '01900000-0000-4000-8000-000000000003';
  v_missing         constant uuid := '01900000-0000-4000-8000-000000000099';
  v_secret          constant text := 'session-secret-sentinel-019-create';
  v_digest          bytea := pg_catalog.sha256(pg_catalog.convert_to(v_secret, 'UTF8'));
  v_result          jsonb;
  v_session_id      uuid;
  v_session_count   bigint;
  v_audit_count     bigint;
  v_bad_request     constant uuid := '01901900-0000-4000-8000-000000000099';
  v_error_message   text;
  v_error_detail    text;
  v_error_hint      text;
  v_error_context   text;
  v_error_state     text;
begin
  v_result := public.create_app_session(
    v_active,
    v_digest,
    '01901900-0000-4000-8000-000000000001'
  );
  insert into session_foundation_test_response values ('create.active', v_result);

  v_session_id := (v_result ->> 'sessionId')::uuid;
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'principalId')::uuid <> v_active
    or v_session_id is null
    or (v_result ->> 'idleExpiresAt')::timestamptz
       <> (
         select session_row.idle_expires_at
         from app_private.app_session session_row
         where session_row.id = v_session_id
       )
    or (v_result ->> 'absoluteExpiresAt')::timestamptz
       <> (
         select session_row.absolute_expires_at
         from app_private.app_session session_row
         where session_row.id = v_session_id
       )
    or (v_result ->> 'rotateAfter')::timestamptz
       <> (
         select session_row.rotate_after
         from app_private.app_session session_row
         where session_row.id = v_session_id
       )
    or exists (
      select 1
      from app_private.app_session session_row
      where session_row.id = v_session_id
        and (
          session_row.last_seen_at <> session_row.created_at
          or session_row.idle_expires_at - session_row.created_at
             <> interval '30 minutes'
          or session_row.absolute_expires_at - session_row.created_at
             <> interval '8 hours'
          or session_row.rotate_after - session_row.created_at
             <> interval '15 minutes'
        )
    )
  then
    raise exception 'active-principal session creation returned an invalid envelope: %',
      v_result;
  end if;

  if v_result::text like '%' || v_secret || '%'
    or not exists (
      select 1
      from app_private.app_session_token token
      where token.session_id = v_session_id
        and token.token_hash = v_digest
        and pg_catalog.octet_length(token.token_hash) = 32
        and token.state = 'current'
    )
  then
    raise exception 'session creation returned or failed to hash-only persist credential material';
  end if;

  if not exists (
    select 1
    from app_private.audit_event audit
    where audit.action = 'session.created'
      and audit.entity_type = 'session'
      and audit.entity_id = v_session_id::text
      and audit.actor_type = 'principal'
      and audit.actor_principal_id = v_active
      and audit.request_id = '01901900-0000-4000-8000-000000000001'
      and audit.metadata = '{}'::jsonb
  ) then
    raise exception 'session creation did not append the expected minimal audit event';
  end if;

  select count(*) into v_session_count from app_private.app_session;
  select count(*) into v_audit_count from app_private.audit_event;

  begin
    perform public.create_app_session(v_suspended, pg_catalog.sha256('suspended'::bytea),
      '01901900-0000-4000-8000-000000000002');
    raise exception 'suspended principal was admitted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    perform public.create_app_session(v_deleted, pg_catalog.sha256('deleted'::bytea),
      '01901900-0000-4000-8000-000000000003');
    raise exception 'deleted principal was admitted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  begin
    perform public.create_app_session(v_missing, pg_catalog.sha256('missing'::bytea),
      '01901900-0000-4000-8000-000000000004');
    raise exception 'missing principal was admitted';
  exception
    when object_not_in_prerequisite_state then null;
  end;

  if (select count(*) from app_private.app_session) <> v_session_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
  then
    raise exception 'rejected principal admission changed session or audit state';
  end if;

  begin
    perform public.create_app_session(v_active, pg_catalog.decode(pg_catalog.repeat('aa', 31), 'hex'),
      '01901900-0000-4000-8000-000000000005');
    raise exception '31-byte session digest was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.create_app_session(v_active, pg_catalog.decode(pg_catalog.repeat('aa', 33), 'hex'),
      '01901900-0000-4000-8000-000000000006');
    raise exception '33-byte session digest was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.create_app_session(v_active, pg_catalog.sha256('null-request'::bytea), null);
    raise exception 'null session request ID was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.use_app_session(v_digest, v_digest,
      '01901900-0000-4000-8000-000000000007');
    raise exception 'session use accepted an identical replacement digest';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    insert into app_private.app_session_token (
      token_hash, session_id, state, created_at, valid_until
    ) values (
      pg_catalog.decode(pg_catalog.repeat('bb', 31), 'hex'),
      v_session_id,
      'retired',
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    );
    raise exception 'direct token storage accepted a 31-byte digest';
  exception
    when check_violation then null;
  end;

  begin
    perform public.create_app_session(v_active, v_digest, v_bad_request);
    raise exception 'duplicate session digest was accepted';
  exception
    when unique_violation then
      get stacked diagnostics
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context,
        v_error_state = returned_sqlstate;

      if v_error_state <> '23505'
        or v_error_message <> 'session digest already exists'
        or coalesce(v_error_detail, '') <> ''
        or coalesce(v_error_hint, '') <> ''
        or coalesce(v_error_context, '') = ''
        or pg_catalog.lower(v_error_context)
           like '%insert into app_private.app_session_token%'
        or lower(pg_catalog.concat_ws(
          ' ',
          v_error_message,
          v_error_detail,
          v_error_hint,
        v_error_context
        )) like '%' || pg_catalog.left(pg_catalog.encode(v_digest, 'hex'), 24) || '%'
        or lower(pg_catalog.concat_ws(
          ' ',
          v_error_message,
          v_error_detail,
          v_error_hint,
          v_error_context
        )) like '%' || v_secret || '%'
      then
        raise exception 'duplicate digest error was not stable and redacted';
      end if;
  end;

  if (select count(*) from app_private.app_session) <> v_session_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
    or exists (
      select 1 from app_private.audit_event where request_id = v_bad_request
    )
  then
    raise exception 'duplicate digest rejection was not atomic';
  end if;
end
$test$;

-- Equality is expired (>=), and a successful idle touch can never cross the
-- eight-hour absolute boundary.
do $test$
declare
  v_principal       constant uuid := '01900000-0000-4000-8000-000000000001';
  v_idle_hash       bytea := pg_catalog.sha256('expiry-idle'::bytea);
  v_absolute_hash   bytea := pg_catalog.sha256('expiry-absolute'::bytea);
  v_touch_hash      bytea := pg_catalog.sha256('expiry-touch-cap'::bytea);
  v_double_touch_hash bytea := pg_catalog.sha256('expiry-double-touch'::bytea);
  v_idle_session    uuid;
  v_absolute_session uuid;
  v_touch_session   uuid;
  v_double_touch_session uuid;
  v_boundary        timestamptz;
  v_last_seen       timestamptz;
  v_first_touch_seen timestamptz;
  v_first_touch_idle timestamptz;
  v_result          jsonb;
begin
  v_idle_session := (
    public.create_app_session(v_principal, v_idle_hash,
      '01901900-0000-4000-8000-000000000010') ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '30 minutes',
      idle_expires_at = v_boundary,
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary + interval '1 hour'
  where id = v_idle_session;
  select last_seen_at into v_last_seen
  from app_private.app_session where id = v_idle_session;

  v_result := public.use_app_session(
    v_idle_hash,
    pg_catalog.sha256('expiry-idle-replacement'::bytea),
    '01901900-0000-4000-8000-000000000011'
  );
  insert into session_foundation_test_response values ('expiry.idle-equality', v_result);
  if v_result <> '{"ok":false}'::jsonb
    or (select last_seen_at from app_private.app_session where id = v_idle_session)
       is distinct from v_last_seen
    or exists (
      select 1 from app_private.app_session_token
      where token_hash = pg_catalog.sha256('expiry-idle-replacement'::bytea)
    )
  then
    raise exception 'idle-expiry equality was accepted or mutated the family: %', v_result;
  end if;

  v_absolute_session := (
    public.create_app_session(v_principal, v_absolute_hash,
      '01901900-0000-4000-8000-000000000012') ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '8 hours',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary,
      absolute_expires_at = v_boundary,
      rotate_after = v_boundary - interval '1 hour'
  where id = v_absolute_session;

  v_result := public.use_app_session(
    v_absolute_hash,
    pg_catalog.sha256('expiry-absolute-replacement'::bytea),
    '01901900-0000-4000-8000-000000000013'
  );
  insert into session_foundation_test_response values ('expiry.absolute-equality', v_result);
  if v_result <> '{"ok":false}'::jsonb
    or exists (
      select 1 from app_private.app_session_token
      where token_hash = pg_catalog.sha256('expiry-absolute-replacement'::bytea)
    )
  then
    raise exception 'absolute-expiry equality was accepted or rotated: %', v_result;
  end if;

  v_touch_session := (
    public.create_app_session(v_principal, v_touch_hash,
      '01901900-0000-4000-8000-000000000014') ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '7 hours 50 minutes',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '10 minutes',
      absolute_expires_at = v_boundary + interval '10 minutes',
      rotate_after = v_boundary + interval '10 minutes'
  where id = v_touch_session;

  v_result := public.use_app_session(
    v_touch_hash,
    pg_catalog.sha256('expiry-touch-unused'::bytea),
    '01901900-0000-4000-8000-000000000015'
  );
  insert into session_foundation_test_response values ('expiry.touch-cap', v_result);
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'status' <> 'active'
    or (v_result ->> 'idleExpiresAt')::timestamptz
       is distinct from (v_result ->> 'absoluteExpiresAt')::timestamptz
    or exists (
      select 1
      from app_private.app_session session_row
      where session_row.id = v_touch_session
        and session_row.idle_expires_at is distinct from session_row.absolute_expires_at
    )
  then
    raise exception 'idle touch was not capped by absolute expiry: %', v_result;
  end if;

  v_double_touch_session := (
    public.create_app_session(
      v_principal,
      v_double_touch_hash,
      '01901903-0000-4000-8000-000000000001'
    ) ->> 'sessionId'
  )::uuid;
  v_result := public.use_app_session(
    v_double_touch_hash,
    pg_catalog.sha256('expiry-double-touch-unused-1'::bytea),
    '01901903-0000-4000-8000-000000000002'
  );
  if v_result ->> 'status' <> 'active' then
    raise exception 'first sequential touch failed: %', v_result;
  end if;
  select last_seen_at, idle_expires_at
  into v_first_touch_seen, v_first_touch_idle
  from app_private.app_session
  where id = v_double_touch_session;

  v_result := public.use_app_session(
    v_double_touch_hash,
    pg_catalog.sha256('expiry-double-touch-unused-2'::bytea),
    '01901903-0000-4000-8000-000000000003'
  );
  if v_result ->> 'status' <> 'active'
    or exists (
      select 1
      from app_private.app_session session_row
      where session_row.id = v_double_touch_session
        and (
          session_row.last_seen_at <= v_first_touch_seen
          or session_row.idle_expires_at <= v_first_touch_idle
          or session_row.idle_expires_at is distinct from least(
            session_row.last_seen_at + interval '30 minutes',
            session_row.absolute_expires_at
          )
        )
    )
  then
    raise exception 'second sequential request did not persist its own exact touch: %',
      v_result;
  end if;
end
$test$;

-- Rotation has one current token, at most one grace token, a 60-second grace
-- window, and family-wide replay response for retired or expired-grace tokens.
do $test$
declare
  v_principal       constant uuid := '01900000-0000-4000-8000-000000000001';
  v_token_1         bytea := pg_catalog.sha256('rotation-family-one-1'::bytea);
  v_token_2         bytea := pg_catalog.sha256('rotation-family-one-2'::bytea);
  v_token_3         bytea := pg_catalog.sha256('rotation-family-one-3'::bytea);
  v_grace_1         bytea := pg_catalog.sha256('rotation-grace-family-1'::bytea);
  v_grace_2         bytea := pg_catalog.sha256('rotation-grace-family-2'::bytea);
  v_collision_hash  bytea := pg_catalog.sha256('rotation-collision-owner'::bytea);
  v_collision_source bytea := pg_catalog.sha256('rotation-collision-source'::bytea);
  v_session_id      uuid;
  v_grace_session   uuid;
  v_collision_owner_session uuid;
  v_collision_source_session uuid;
  v_result          jsonb;
  v_rotation_count  integer;
  v_boundary        timestamptz;
  v_before_last_seen timestamptz;
  v_before_idle     timestamptz;
  v_before_rotate   timestamptz;
  v_before_token_count bigint;
  v_before_audit_count bigint;
  v_error_message  text;
  v_error_detail   text;
  v_error_hint     text;
  v_error_context  text;
  v_error_state    text;
begin
  v_session_id := (
    public.create_app_session(v_principal, v_token_1,
      '01901900-0000-4000-8000-000000000020') ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '29 minutes',
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary - interval '1 second'
  where id = v_session_id;

  v_result := public.use_app_session(
    v_token_1,
    v_token_2,
    '01901900-0000-4000-8000-000000000021'
  );
  insert into session_foundation_test_response values ('rotation.first', v_result);
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'status' <> 'rotated'
    or (
      select count(*) from app_private.app_session_token
      where session_id = v_session_id and state = 'current'
    ) <> 1
    or (
      select count(*) from app_private.app_session_token
      where session_id = v_session_id and state = 'grace'
    ) <> 1
    or not exists (
      select 1 from app_private.app_session_token
      where token_hash = v_token_1 and session_id = v_session_id
        and state = 'grace'
        and valid_until <= pg_catalog.clock_timestamp() + interval '60 seconds'
        and valid_until > pg_catalog.clock_timestamp()
    )
    or not exists (
      select 1 from app_private.app_session_token
      where token_hash = v_token_2 and session_id = v_session_id
        and state = 'current' and valid_until is null
    )
  then
    raise exception 'first session rotation violated current/grace invariants: %', v_result;
  end if;

  select rotation_count into v_rotation_count
  from app_private.app_session where id = v_session_id;

  v_result := public.use_app_session(
    v_token_1,
    pg_catalog.sha256('rotation-grace-unused'::bytea),
    '01901900-0000-4000-8000-000000000022'
  );
  insert into session_foundation_test_response values ('rotation.live-grace', v_result);
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'status' <> 'grace'
    or exists (
      select 1 from app_private.app_session_token
      where token_hash = pg_catalog.sha256('rotation-grace-unused'::bytea)
    )
    or (select rotation_count from app_private.app_session where id = v_session_id)
       <> v_rotation_count
  then
    raise exception 'live grace token was not accepted without rotation: %', v_result;
  end if;

  update app_private.app_session
  set rotate_after = pg_catalog.clock_timestamp() - interval '1 second'
  where id = v_session_id;
  v_result := public.use_app_session(
    v_token_2,
    v_token_3,
    '01901900-0000-4000-8000-000000000023'
  );
  insert into session_foundation_test_response values ('rotation.second', v_result);
  if v_result ->> 'status' <> 'rotated'
    or not exists (
      select 1 from app_private.app_session_token
      where token_hash = v_token_1 and state = 'retired'
    )
    or not exists (
      select 1 from app_private.app_session_token
      where token_hash = v_token_2 and state = 'grace'
    )
    or not exists (
      select 1 from app_private.app_session_token
      where token_hash = v_token_3 and state = 'current'
    )
  then
    raise exception 'second rotation did not retire the prior grace generation: %', v_result;
  end if;

  v_result := public.use_app_session(
    v_token_1,
    pg_catalog.sha256('rotation-replay-unused'::bytea),
    '01901900-0000-4000-8000-000000000024'
  );
  insert into session_foundation_test_response values ('rotation.retired-replay', v_result);
  if v_result <> '{"ok":false}'::jsonb
    or not exists (
      select 1 from app_private.app_session
      where id = v_session_id
        and revoked_at is not null
        and revoke_reason = 'token_reuse'
    )
    or (
      select count(*)
      from app_private.audit_event audit
      where audit.action = 'session.revoked'
        and audit.entity_id = v_session_id::text
        and audit.actor_type = 'system'
        and audit.actor_principal_id is null
        and audit.metadata = '{"reason":"token_reuse"}'::jsonb
    ) <> 1
  then
    raise exception 'retired-token replay did not revoke and audit the family: %', v_result;
  end if;

  perform public.use_app_session(
    v_token_1,
    pg_catalog.sha256('rotation-repeat-replay'::bytea),
    '01901900-0000-4000-8000-000000000025'
  );
  v_result := public.use_app_session(
    v_token_3,
    pg_catalog.sha256('rotation-revoked-current'::bytea),
    '01901900-0000-4000-8000-000000000026'
  );
  insert into session_foundation_test_response values ('rotation.revoked-current', v_result);
  if v_result <> '{"ok":false}'::jsonb
    or (
      select count(*) from app_private.audit_event audit
      where audit.action = 'session.revoked'
        and audit.entity_id = v_session_id::text
        and audit.metadata = '{"reason":"token_reuse"}'::jsonb
    ) <> 1
  then
    raise exception 'replay family revocation was not idempotent';
  end if;

  v_grace_session := (
    public.create_app_session(v_principal, v_grace_1,
      '01901900-0000-4000-8000-000000000027') ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '29 minutes',
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary - interval '1 second'
  where id = v_grace_session;
  perform public.use_app_session(
    v_grace_1,
    v_grace_2,
    '01901900-0000-4000-8000-000000000028'
  );
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session_token
  set valid_until = v_boundary
  where token_hash = v_grace_1 and state = 'grace';

  v_result := public.use_app_session(
    v_grace_1,
    pg_catalog.sha256('rotation-expired-grace-unused'::bytea),
    '01901900-0000-4000-8000-000000000029'
  );
  insert into session_foundation_test_response values ('rotation.grace-equality', v_result);
  if v_result <> '{"ok":false}'::jsonb
    or not exists (
      select 1 from app_private.app_session
      where id = v_grace_session
        and revoked_at is not null
        and revoke_reason = 'token_reuse'
    )
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000029'
        and action = 'session.revoked'
        and entity_id = v_grace_session::text
        and metadata = '{"reason":"token_reuse"}'::jsonb
    )
  then
    raise exception 'grace-expiry equality did not trigger replay handling: %', v_result;
  end if;

  -- A replacement digest that already belongs to another family must fail
  -- atomically. Native PostgreSQL unique errors include the bytea key in
  -- DETAIL, so the RPC must preserve 23505 while redacting every diagnostic.
  v_collision_owner_session := (
    public.create_app_session(
      v_principal,
      v_collision_hash,
      '01901901-0000-4000-8000-000000000001'
    ) ->> 'sessionId'
  )::uuid;
  v_collision_source_session := (
    public.create_app_session(
      v_principal,
      v_collision_source,
      '01901901-0000-4000-8000-000000000002'
    ) ->> 'sessionId'
  )::uuid;

  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '29 minutes',
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary - interval '1 second'
  where id = v_collision_source_session;

  select last_seen_at, idle_expires_at, rotate_after, rotation_count
  into v_before_last_seen, v_before_idle, v_before_rotate, v_rotation_count
  from app_private.app_session
  where id = v_collision_source_session;
  select count(*)
  into v_before_token_count
  from app_private.app_session_token
  where session_id = v_collision_source_session;
  select count(*)
  into v_before_audit_count
  from app_private.audit_event
  where entity_type = 'session'
    and entity_id = v_collision_source_session::text;

  begin
    perform public.use_app_session(
      v_collision_source,
      v_collision_hash,
      '01901901-0000-4000-8000-000000000003'
    );
    raise exception 'duplicate replacement digest was accepted';
  exception
    when unique_violation then
      get stacked diagnostics
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context,
        v_error_state = returned_sqlstate;

      if v_error_state <> '23505'
        or v_error_message <> 'session digest already exists'
        or coalesce(v_error_detail, '') <> ''
        or coalesce(v_error_hint, '') <> ''
        or coalesce(v_error_context, '') = ''
        or pg_catalog.lower(v_error_context)
           like '%insert into app_private.app_session_token%'
        or lower(pg_catalog.concat_ws(
          ' ',
          v_error_message,
          v_error_detail,
          v_error_hint,
          v_error_context
        )) like '%'
          || pg_catalog.left(pg_catalog.encode(v_collision_hash, 'hex'), 24)
          || '%'
        or lower(pg_catalog.concat_ws(
          ' ',
          v_error_message,
          v_error_detail,
          v_error_hint,
          v_error_context
        )) like '%'
          || pg_catalog.left(pg_catalog.encode(v_collision_source, 'hex'), 24)
          || '%'
      then
        raise exception 'replacement collision error was not stable and redacted';
      end if;
  end;

  if not exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = v_collision_hash
        and token.session_id = v_collision_owner_session
        and token.state = 'current'
    )
    or not exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = v_collision_source
        and token.session_id = v_collision_source_session
        and token.state = 'current'
    )
    or (select count(*) from app_private.app_session_token
        where session_id = v_collision_source_session) <> v_before_token_count
    or exists (
      select 1
      from app_private.app_session session_row
      where session_row.id = v_collision_source_session
        and (
          session_row.last_seen_at is distinct from v_before_last_seen
          or session_row.idle_expires_at is distinct from v_before_idle
          or session_row.rotate_after is distinct from v_before_rotate
          or session_row.rotation_count <> v_rotation_count
        )
    )
    or (select count(*) from app_private.audit_event
        where entity_type = 'session'
          and entity_id = v_collision_source_session::text) <> v_before_audit_count
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901901-0000-4000-8000-000000000003'
    )
  then
    raise exception 'duplicate replacement digest rejection was not atomic';
  end if;
end
$test$;

-- A current token may be valid at rest with a future created_at, while rotating
-- it to grace would make valid_until precede created_at. The native CHECK
-- DETAIL includes the token digest, so the session boundary must redact that
-- diagnostic and roll back every partially applied rotation change.
do $test$
declare
  v_principal        constant uuid := '01900000-0000-4000-8000-000000000001';
  v_token             bytea := pg_catalog.sha256(
    pg_catalog.convert_to('future-session-token-redaction-sentinel', 'UTF8')
  );
  v_replacement       bytea := pg_catalog.sha256(
    pg_catalog.convert_to('future-session-replacement-redaction-sentinel', 'UTF8')
  );
  v_session_id        uuid;
  v_boundary          timestamptz;
  v_future_created_at timestamptz;
  v_before_last_seen  timestamptz;
  v_before_idle       timestamptz;
  v_before_rotate     timestamptz;
  v_token_prefix      text;
  v_replacement_prefix text;
  v_error_state       text;
  v_error_message     text;
  v_error_detail      text;
  v_error_hint        text;
  v_error_context     text;
  v_diagnostics       text;
begin
  v_session_id := (
    public.create_app_session(
      v_principal,
      v_token,
      '01901901-0000-4000-8000-000000000004'
    ) ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  v_future_created_at := v_boundary + interval '1 hour';

  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '29 minutes',
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary - interval '1 second'
  where id = v_session_id;

  update app_private.app_session_token
  set created_at = v_future_created_at
  where token_hash = v_token
    and session_id = v_session_id
    and state = 'current';

  select last_seen_at, idle_expires_at, rotate_after
  into v_before_last_seen, v_before_idle, v_before_rotate
  from app_private.app_session
  where id = v_session_id;
  v_token_prefix := pg_catalog.left(pg_catalog.encode(v_token, 'hex'), 24);
  v_replacement_prefix := pg_catalog.left(
    pg_catalog.encode(v_replacement, 'hex'),
    24
  );

  begin
    perform public.use_app_session(
      v_token,
      v_replacement,
      '01901901-0000-4000-8000-000000000005'
    );
    raise exception 'future token timestamp did not reject rotation';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;

      v_diagnostics := pg_catalog.concat_ws(
        E'\n',
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context
      );
      if v_error_state <> '23514'
        or v_error_message <> 'session state constraint violation'
        or coalesce(v_error_detail, '') <> ''
        or coalesce(v_error_hint, '') <> ''
        or coalesce(v_error_context, '') = ''
        or v_diagnostics like '%' || v_token_prefix || '%'
        or v_diagnostics like '%' || v_replacement_prefix || '%'
        or v_diagnostics like '%future-session-token-redaction-sentinel%'
        or v_diagnostics like '%future-session-replacement-redaction-sentinel%'
        or v_diagnostics like '%Failing row contains%'
        or v_diagnostics like '%app_session_token_validity_check%'
        or pg_catalog.lower(v_error_context)
           like '%update app_private.app_session_token%'
      then
        raise exception 'future token constraint diagnostics were not stable and redacted';
      end if;
  end;

  if not exists (
      select 1
      from app_private.app_session_token
      where token_hash = v_token
        and session_id = v_session_id
        and state = 'current'
        and created_at = v_future_created_at
        and valid_until is null
    )
    or exists (
      select 1
      from app_private.app_session_token
      where token_hash = v_replacement
    )
    or exists (
      select 1
      from app_private.app_session
      where id = v_session_id
        and (
          last_seen_at is distinct from v_before_last_seen
          or idle_expires_at is distinct from v_before_idle
          or rotate_after is distinct from v_before_rotate
          or rotation_count <> 0
        )
    )
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901901-0000-4000-8000-000000000005'
    )
  then
    raise exception 'future token constraint rejection was not atomic';
  end if;
end
$test$;

-- Logout, single administrative revocation, and bulk revocation are all
-- idempotent and append exactly one correctly attributed audit per transition.
do $test$
declare
  v_target          constant uuid := '01900000-0000-4000-8000-000000000005';
  v_status_target   constant uuid := '01900000-0000-4000-8000-000000000006';
  v_other           constant uuid := '01900000-0000-4000-8000-000000000007';
  v_actor           constant uuid := '01900000-0000-4000-8000-000000000004';
  v_inactive_actor  constant uuid := '01900000-0000-4000-8000-000000000002';
  v_missing_actor   constant uuid := '01900000-0000-4000-8000-000000000099';
  v_logout_hash     bytea := pg_catalog.sha256('revoke-logout'::bytea);
  v_admin_hash      bytea := pg_catalog.sha256('revoke-admin'::bytea);
  v_inactive_hash   bytea := pg_catalog.sha256('revoke-inactive-actor'::bytea);
  v_security_hash   bytea := pg_catalog.sha256('revoke-security'::bytea);
  v_bulk_1          bytea := pg_catalog.sha256('revoke-bulk-1'::bytea);
  v_bulk_2          bytea := pg_catalog.sha256('revoke-bulk-2'::bytea);
  v_bulk_keep       bytea := pg_catalog.sha256('revoke-bulk-keep'::bytea);
  v_status_hash     bytea := pg_catalog.sha256('revoke-principal-status'::bytea);
  v_other_hash      bytea := pg_catalog.sha256('revoke-other'::bytea);
  v_logout_session  uuid;
  v_admin_session   uuid;
  v_inactive_session uuid;
  v_security_session uuid;
  v_bulk_session_1  uuid;
  v_bulk_session_2  uuid;
  v_bulk_keep_session uuid;
  v_status_session  uuid;
  v_other_session   uuid;
  v_result          jsonb;
begin
  v_logout_session := (
    public.create_app_session(v_target, v_logout_hash,
      '01901900-0000-4000-8000-000000000030') ->> 'sessionId'
  )::uuid;
  v_result := public.logout_app_session(
    v_logout_hash,
    '01901900-0000-4000-8000-000000000031'
  );
  insert into session_foundation_test_response values ('revoke.logout', v_result);
  if v_result <> '{"ok":true,"revoked":true}'::jsonb
    or not exists (
      select 1 from app_private.app_session
      where id = v_logout_session and revoke_reason = 'logout'
    )
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000031'
        and action = 'session.revoked'
        and actor_type = 'principal'
        and actor_principal_id = v_target
        and entity_id = v_logout_session::text
        and metadata = '{"reason":"logout"}'::jsonb
    )
  then
    raise exception 'logout did not revoke and audit its family: %', v_result;
  end if;

  v_result := public.logout_app_session(
    v_logout_hash,
    '01901900-0000-4000-8000-000000000032'
  );
  insert into session_foundation_test_response values ('revoke.logout-repeat', v_result);
  if v_result <> '{"ok":true,"revoked":false}'::jsonb
    or exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000032'
    )
  then
    raise exception 'logout replay was not idempotent: %', v_result;
  end if;

  v_result := public.logout_app_session(
    pg_catalog.sha256('revoke-missing'::bytea),
    '01901900-0000-4000-8000-000000000033'
  );
  if v_result <> '{"ok":true,"revoked":false}'::jsonb then
    raise exception 'logout leaked missing-token state: %', v_result;
  end if;

  v_admin_session := (
    public.create_app_session(v_target, v_admin_hash,
      '01901900-0000-4000-8000-000000000034') ->> 'sessionId'
  )::uuid;
  v_result := public.revoke_app_session(
    v_admin_session,
    v_actor,
    'administrator',
    '01901900-0000-4000-8000-000000000035'
  );
  insert into session_foundation_test_response values ('revoke.admin', v_result);
  if v_result <> '{"ok":true,"revoked":true}'::jsonb
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000035'
        and actor_type = 'principal'
        and actor_principal_id = v_actor
        and action = 'session.revoked'
        and entity_id = v_admin_session::text
        and metadata = '{"reason":"administrator"}'::jsonb
    )
  then
    raise exception 'administrator revocation attribution is invalid: %', v_result;
  end if;

  v_result := public.revoke_app_session(
    v_admin_session,
    v_actor,
    'administrator',
    '01901900-0000-4000-8000-000000000036'
  );
  if v_result <> '{"ok":true,"revoked":false}'::jsonb
    or exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000036'
    )
  then
    raise exception 'single-session administrative revocation was not idempotent';
  end if;

  begin
    perform public.revoke_app_session(
      v_admin_session,
      null,
      'administrator',
      '01901900-0000-4000-8000-000000000037'
    );
    raise exception 'administrator revocation accepted a null actor';
  exception
    when invalid_parameter_value then null;
  end;

  v_inactive_session := (
    public.create_app_session(
      v_target,
      v_inactive_hash,
      '01901902-0000-4000-8000-000000000001'
    ) ->> 'sessionId'
  )::uuid;
  begin
    perform public.revoke_app_session(
      v_inactive_session,
      v_inactive_actor,
      'administrator',
      '01901902-0000-4000-8000-000000000002'
    );
    raise exception 'administrator revocation accepted an inactive actor';
  exception
    when invalid_parameter_value then null;
  end;
  if exists (
      select 1
      from app_private.app_session
      where id = v_inactive_session and revoked_at is not null
    )
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901902-0000-4000-8000-000000000002'
    )
  then
    raise exception 'inactive administrator actor rejection changed state';
  end if;

  begin
    perform public.revoke_app_session(
      v_inactive_session,
      v_missing_actor,
      'security_event',
      '01901902-0000-4000-8000-000000000003'
    );
    raise exception 'security-event revocation accepted a missing actor';
  exception
    when invalid_parameter_value then null;
  end;

  v_result := public.revoke_app_session(
    v_inactive_session,
    v_inactive_actor,
    'security_event',
    '01901902-0000-4000-8000-000000000004'
  );
  if v_result <> '{"ok":true,"revoked":true}'::jsonb
    or not exists (
      select 1
      from app_private.audit_event
      where request_id = '01901902-0000-4000-8000-000000000004'
        and actor_type = 'principal'
        and actor_principal_id = v_inactive_actor
        and metadata = '{"reason":"security_event"}'::jsonb
    )
  then
    raise exception 'security-event revocation rejected an existing inactive actor';
  end if;

  v_security_session := (
    public.create_app_session(v_target, v_security_hash,
      '01901900-0000-4000-8000-000000000038') ->> 'sessionId'
  )::uuid;
  v_result := public.revoke_app_session(
    v_security_session,
    null,
    'security_event',
    '01901900-0000-4000-8000-000000000039'
  );
  insert into session_foundation_test_response values ('revoke.security', v_result);
  if v_result <> '{"ok":true,"revoked":true}'::jsonb
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000039'
        and actor_type = 'system'
        and actor_principal_id is null
        and entity_id = v_security_session::text
        and metadata = '{"reason":"security_event"}'::jsonb
    )
  then
    raise exception 'system security-event revocation attribution is invalid: %', v_result;
  end if;

  v_bulk_session_1 := (
    public.create_app_session(v_target, v_bulk_1,
      '01901900-0000-4000-8000-000000000040') ->> 'sessionId'
  )::uuid;
  v_bulk_session_2 := (
    public.create_app_session(v_target, v_bulk_2,
      '01901900-0000-4000-8000-000000000041') ->> 'sessionId'
  )::uuid;
  v_bulk_keep_session := (
    public.create_app_session(v_target, v_bulk_keep,
      '01901900-0000-4000-8000-000000000042') ->> 'sessionId'
  )::uuid;
  v_other_session := (
    public.create_app_session(v_other, v_other_hash,
      '01901900-0000-4000-8000-000000000043') ->> 'sessionId'
  )::uuid;

  begin
    perform public.revoke_principal_sessions(
      v_target,
      v_other_session,
      v_actor,
      'administrator',
      '01901900-0000-4000-8000-000000000044'
    );
    raise exception 'bulk revocation accepted another principal session as its exception';
  exception
    when invalid_parameter_value then null;
  end;
  if (
    select count(*) from app_private.app_session
    where id in (v_bulk_session_1, v_bulk_session_2, v_bulk_keep_session)
      and revoked_at is null
  ) <> 3 then
    raise exception 'invalid bulk exception changed target sessions';
  end if;

  begin
    perform public.revoke_principal_sessions(
      v_target,
      v_bulk_keep_session,
      v_inactive_actor,
      'administrator',
      '01901902-0000-4000-8000-000000000005'
    );
    raise exception 'bulk administrator revocation accepted an inactive actor';
  exception
    when invalid_parameter_value then null;
  end;
  if (
      select count(*)
      from app_private.app_session
      where id in (v_bulk_session_1, v_bulk_session_2, v_bulk_keep_session)
        and revoked_at is null
    ) <> 3
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901902-0000-4000-8000-000000000005'
    )
  then
    raise exception 'inactive bulk administrator actor rejection changed state';
  end if;

  v_result := public.revoke_principal_sessions(
    v_target,
    v_bulk_keep_session,
    v_actor,
    'administrator',
    '01901900-0000-4000-8000-000000000045'
  );
  insert into session_foundation_test_response values ('revoke.bulk', v_result);
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'revoked')::integer <> 2
    or (
      select count(*) from app_private.app_session
      where id in (v_bulk_session_1, v_bulk_session_2)
        and revoke_reason = 'administrator'
    ) <> 2
    or not exists (
      select 1 from app_private.app_session
      where id = v_bulk_keep_session and revoked_at is null
    )
    or (
      select count(*) from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000045'
        and actor_type = 'principal'
        and actor_principal_id = v_actor
        and action = 'session.revoked'
        and metadata = '{"reason":"administrator"}'::jsonb
    ) <> 2
  then
    raise exception 'bulk revocation did not preserve its exception or per-session audit: %',
      v_result;
  end if;

  v_result := public.revoke_principal_sessions(
    v_target,
    v_bulk_keep_session,
    v_actor,
    'administrator',
    '01901900-0000-4000-8000-000000000046'
  );
  if (v_result ->> 'revoked')::integer <> 0
    or exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000046'
    )
  then
    raise exception 'bulk revocation replay was not idempotent: %', v_result;
  end if;

  v_status_session := (
    public.create_app_session(v_status_target, v_status_hash,
      '01901900-0000-4000-8000-000000000047') ->> 'sessionId'
  )::uuid;
  update app_private.principal
  set status = 'suspended'
  where id = v_status_target;
  v_result := public.revoke_principal_sessions(
    v_status_target,
    null,
    null,
    'principal_status',
    '01901900-0000-4000-8000-000000000048'
  );
  insert into session_foundation_test_response values ('revoke.principal-status', v_result);
  if (v_result ->> 'revoked')::integer <> 1
    or not exists (
      select 1 from app_private.app_session
      where id = v_status_session and revoke_reason = 'principal_status'
    )
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000048'
        and actor_type = 'system'
        and actor_principal_id is null
        and metadata = '{"reason":"principal_status"}'::jsonb
    )
  then
    raise exception 'principal-status bulk revocation was not system attributed: %', v_result;
  end if;
end
$test$;

-- Login throttles use independent keyed dimensions: five account attempts and
-- thirty network attempts per 15-minute window. Clearing an account never
-- refunds the shared network quota.
do $test$
declare
  v_account         bytea := pg_catalog.sha256('throttle-account-5'::bytea);
  v_network         bytea;
  v_network_shared  bytea := pg_catalog.sha256('throttle-network-30'::bytea);
  v_account_each    bytea;
  v_result          jsonb;
  v_index           integer;
  v_boundary        timestamptz;
  v_reset_account   bytea := pg_catalog.sha256('throttle-reset-account'::bytea);
  v_reset_network   bytea := pg_catalog.sha256('throttle-reset-network'::bytea);
  v_equal_account   bytea := pg_catalog.sha256('throttle-equal-account'::bytea);
  v_equal_network   bytea := pg_catalog.sha256('throttle-equal-network'::bytea);
begin
  for v_index in 1..6 loop
    v_network := pg_catalog.sha256(
      pg_catalog.convert_to('throttle-account-network-' || v_index::text, 'UTF8')
    );
    v_result := public.consume_login_attempt(v_account, v_network);
    insert into session_foundation_test_response values (
      'throttle.account.' || v_index::text,
      v_result
    );

    if v_index <= 5 and (
      not coalesce((v_result ->> 'allowed')::boolean, false)
      or (v_result ->> 'retryAfterSeconds')::integer <> 0
    ) then
      raise exception 'account attempt % was rejected before the five-attempt limit: %',
        v_index, v_result;
    elsif v_index = 6 and (
      coalesce((v_result ->> 'allowed')::boolean, true)
      or (v_result ->> 'retryAfterSeconds')::integer <> 900
    ) then
      raise exception 'sixth account attempt was not blocked for 15 minutes: %', v_result;
    end if;
  end loop;

  if not exists (
    select 1 from app_private.login_throttle
    where scope = 'account' and fingerprint = v_account
      and attempt_count = 6 and blocked_until is not null
  ) then
    raise exception 'account throttle ledger did not persist the 5/15 boundary';
  end if;

  for v_index in 1..31 loop
    v_account_each := pg_catalog.sha256(
      pg_catalog.convert_to('throttle-network-account-' || v_index::text, 'UTF8')
    );
    v_result := public.consume_login_attempt(v_account_each, v_network_shared);
    insert into session_foundation_test_response values (
      'throttle.network.' || v_index::text,
      v_result
    );

    if v_index <= 30 and (
      not coalesce((v_result ->> 'allowed')::boolean, false)
      or (v_result ->> 'retryAfterSeconds')::integer <> 0
    ) then
      raise exception 'network attempt % was rejected before the thirty-attempt limit: %',
        v_index, v_result;
    elsif v_index = 31 and (
      coalesce((v_result ->> 'allowed')::boolean, true)
      or (v_result ->> 'retryAfterSeconds')::integer <> 900
    ) then
      raise exception 'thirty-first network attempt was not blocked for 15 minutes: %',
        v_result;
    end if;
  end loop;

  if not exists (
    select 1 from app_private.login_throttle
    where scope = 'network' and fingerprint = v_network_shared
      and attempt_count = 31 and blocked_until is not null
  ) then
    raise exception 'network throttle ledger did not persist the 30/15 boundary';
  end if;

  v_result := public.clear_login_account_throttle(v_account);
  insert into session_foundation_test_response values ('throttle.clear-account', v_result);
  if v_result <> '{"ok":true,"cleared":true}'::jsonb
    or exists (
      select 1 from app_private.login_throttle
      where scope = 'account' and fingerprint = v_account
    )
    or not exists (
      select 1 from app_private.login_throttle
      where scope = 'network'
        and fingerprint = pg_catalog.sha256(
          pg_catalog.convert_to('throttle-account-network-6', 'UTF8')
        )
    )
  then
    raise exception 'account throttle clear removed the wrong dimension: %', v_result;
  end if;

  v_result := public.clear_login_account_throttle(v_account);
  if v_result <> '{"ok":true,"cleared":false}'::jsonb then
    raise exception 'account throttle clear was not idempotent: %', v_result;
  end if;

  v_result := public.consume_login_attempt(
    v_account,
    pg_catalog.sha256('throttle-after-clear-network'::bytea)
  );
  if not coalesce((v_result ->> 'allowed')::boolean, false) then
    raise exception 'cleared account did not receive a fresh account window: %', v_result;
  end if;

  perform public.consume_login_attempt(v_reset_account, v_reset_network);
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.login_throttle
  set window_started_at = v_boundary - interval '15 minutes',
      attempt_count = case when scope = 'account' then 5 else 30 end,
      blocked_until = null,
      updated_at = v_boundary
  where (scope = 'account' and fingerprint = v_reset_account)
     or (scope = 'network' and fingerprint = v_reset_network);

  v_result := public.consume_login_attempt(v_reset_account, v_reset_network);
  insert into session_foundation_test_response values ('throttle.window-equality', v_result);
  if not coalesce((v_result ->> 'allowed')::boolean, false)
    or exists (
      select 1 from app_private.login_throttle
      where ((scope = 'account' and fingerprint = v_reset_account)
          or (scope = 'network' and fingerprint = v_reset_network))
        and attempt_count <> 1
    )
  then
    raise exception '15-minute window equality did not reset both dimensions: %', v_result;
  end if;

  perform public.consume_login_attempt(v_equal_account, v_equal_network);
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.login_throttle
  set window_started_at = v_boundary - interval '1 minute',
      attempt_count = 0,
      blocked_until = v_boundary,
      updated_at = v_boundary
  where scope = 'account' and fingerprint = v_equal_account;

  v_result := public.consume_login_attempt(v_equal_account, v_equal_network);
  insert into session_foundation_test_response values ('throttle.block-equality', v_result);
  if not coalesce((v_result ->> 'allowed')::boolean, false)
    or (v_result ->> 'retryAfterSeconds')::integer <> 0
  then
    raise exception 'blocked-until equality remained blocked: %', v_result;
  end if;

  begin
    perform public.consume_login_attempt(
      pg_catalog.decode(pg_catalog.repeat('cc', 31), 'hex'),
      v_equal_network
    );
    raise exception '31-byte account fingerprint was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.clear_login_account_throttle(
      pg_catalog.decode(pg_catalog.repeat('dd', 33), 'hex')
    );
    raise exception '33-byte account fingerprint was accepted by clear';
  exception
    when invalid_parameter_value then null;
  end;
end
$test$;

-- A clock-skewed throttle row can be valid at rest while a subsequent attempt
-- would move updated_at behind its future window_started_at. PostgreSQL's
-- native CHECK DETAIL contains the fingerprint-bearing row, so the private RPC
-- boundary must retain only the useful SQLSTATE and a stable redacted message.
-- The network dimension is deliberately second: its failure must also roll
-- back the account mutation completed earlier in the same attempt.
do $test$
declare
  v_account_fingerprint bytea := pg_catalog.sha256(
    pg_catalog.convert_to('future-throttle-account-redaction-sentinel', 'UTF8')
  );
  v_network_fingerprint bytea := pg_catalog.sha256(
    pg_catalog.convert_to('future-throttle-network-redaction-sentinel', 'UTF8')
  );
  v_future              timestamptz := pg_catalog.clock_timestamp() + interval '1 hour';
  v_account_prefix      text;
  v_network_prefix      text;
  v_error_state         text;
  v_error_message       text;
  v_error_detail        text;
  v_error_hint          text;
  v_error_context       text;
  v_diagnostics         text;
begin
  v_account_prefix := pg_catalog.left(
    pg_catalog.encode(v_account_fingerprint, 'hex'),
    24
  );
  v_network_prefix := pg_catalog.left(
    pg_catalog.encode(v_network_fingerprint, 'hex'),
    24
  );

  insert into app_private.login_throttle (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  ) values (
    'network',
    v_network_fingerprint,
    v_future,
    0,
    null,
    v_future
  );

  begin
    perform public.consume_login_attempt(
      v_account_fingerprint,
      v_network_fingerprint
    );
    raise exception 'future throttle timestamp did not reject the attempt';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;

      v_diagnostics := pg_catalog.concat_ws(
        E'\n',
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context
      );
      if v_error_state <> '23514'
        or v_error_message <> 'login throttle state constraint violation'
        or coalesce(v_error_detail, '') <> ''
        or coalesce(v_error_hint, '') <> ''
        or coalesce(v_error_context, '') = ''
        or v_diagnostics like '%' || v_account_prefix || '%'
        or v_diagnostics like '%' || v_network_prefix || '%'
        or v_diagnostics like '%future-throttle-account-redaction-sentinel%'
        or v_diagnostics like '%future-throttle-network-redaction-sentinel%'
        or v_diagnostics like '%Failing row contains%'
        or v_diagnostics like '%login_throttle_time_order_check%'
        or pg_catalog.lower(v_error_context)
           like '%update app_private.login_throttle%'
      then
        raise exception 'future throttle constraint diagnostics were not stable and redacted';
      end if;
  end;

  if exists (
    select 1
    from app_private.login_throttle
    where scope = 'account'
      and fingerprint = v_account_fingerprint
  )
    or not exists (
      select 1
      from app_private.login_throttle
      where scope = 'network'
        and fingerprint = v_network_fingerprint
        and window_started_at = v_future
        and attempt_count = 0
        and blocked_until is null
        and updated_at = v_future
    )
  then
    raise exception 'future throttle constraint rejection was not atomic';
  end if;
end
$test$;

-- Cleanup deletes deterministic, independently bounded batches only after a
-- full 24-hour terminal retention window. Active expirations append immutable
-- timeout evidence and cascade their token families in one atomic statement
-- and transaction; no physical sibling-CTE execution order is assumed.
do $test$
declare
  v_principal          constant uuid := '01900000-0000-4000-8000-000000000008';
  v_idle_hash          bytea := pg_catalog.sha256('cleanup-expired-idle'::bytea);
  v_absolute_hash      bytea := pg_catalog.sha256('cleanup-expired-absolute'::bytea);
  v_revoked_hash       bytea := pg_catalog.sha256('cleanup-revoked-old'::bytea);
  v_recent_expired_hash bytea := pg_catalog.sha256('cleanup-expired-recent'::bytea);
  v_recent_revoked_hash bytea := pg_catalog.sha256('cleanup-revoked-recent'::bytea);
  v_idle_session       uuid;
  v_absolute_session   uuid;
  v_revoked_session    uuid;
  v_recent_expired_session uuid;
  v_recent_revoked_session uuid;
  v_boundary           timestamptz;
  v_result             jsonb;
  v_index              integer;
  v_fingerprint        bytea;
  v_session_count      bigint;
  v_throttle_count     bigint;
begin
  v_idle_session := (
    public.create_app_session(v_principal, v_idle_hash,
      '01901900-0000-4000-8000-000000000060') ->> 'sessionId'
  )::uuid;
  v_absolute_session := (
    public.create_app_session(v_principal, v_absolute_hash,
      '01901900-0000-4000-8000-000000000061') ->> 'sessionId'
  )::uuid;
  v_revoked_session := (
    public.create_app_session(v_principal, v_revoked_hash,
      '01901900-0000-4000-8000-000000000062') ->> 'sessionId'
  )::uuid;
  perform public.logout_app_session(
    v_revoked_hash,
    '01901900-0000-4000-8000-000000000063'
  );
  v_recent_expired_session := (
    public.create_app_session(v_principal, v_recent_expired_hash,
      '01901900-0000-4000-8000-000000000064') ->> 'sessionId'
  )::uuid;
  v_recent_revoked_session := (
    public.create_app_session(v_principal, v_recent_revoked_hash,
      '01901900-0000-4000-8000-000000000065') ->> 'sessionId'
  )::uuid;
  perform public.logout_app_session(
    v_recent_revoked_hash,
    '01901900-0000-4000-8000-000000000066'
  );

  v_boundary := pg_catalog.clock_timestamp();

  -- Earliest candidate: idle timeout more than 30 hours ago.
  update app_private.app_session
  set created_at = v_boundary - interval '31 hours',
      last_seen_at = v_boundary - interval '31 hours',
      idle_expires_at = v_boundary - interval '30 hours 30 minutes',
      absolute_expires_at = v_boundary - interval '23 hours',
      rotate_after = v_boundary - interval '30 hours 45 minutes'
  where id = v_idle_session;

  -- Second candidate: absolute timeout 25 hours ago. Equality between idle and
  -- absolute expiry must classify this as an absolute timeout.
  update app_private.app_session
  set created_at = v_boundary - interval '33 hours',
      last_seen_at = v_boundary - interval '25 hours 1 minute',
      idle_expires_at = v_boundary - interval '25 hours',
      absolute_expires_at = v_boundary - interval '25 hours',
      rotate_after = v_boundary - interval '32 hours 45 minutes'
  where id = v_absolute_session;

  -- Third candidate: already-revoked token family exactly at the 24-hour
  -- retention boundary. It is deleted without a second terminal audit.
  update app_private.app_session
  set created_at = v_boundary - interval '32 hours',
      last_seen_at = v_boundary - interval '31 hours',
      idle_expires_at = v_boundary - interval '30 hours 30 minutes',
      absolute_expires_at = v_boundary - interval '24 hours',
      rotate_after = v_boundary - interval '31 hours 45 minutes',
      revoked_at = v_boundary - interval '24 hours',
      revoke_reason = 'logout'
  where id = v_revoked_session;

  -- These two are terminal for less than 24 hours and must survive every batch.
  update app_private.app_session
  set created_at = v_boundary - interval '24 hours 29 minutes',
      last_seen_at = v_boundary - interval '24 hours 29 minutes',
      idle_expires_at = v_boundary - interval '23 hours 59 minutes',
      absolute_expires_at = v_boundary - interval '16 hours 29 minutes',
      rotate_after = v_boundary - interval '24 hours 14 minutes'
  where id = v_recent_expired_session;

  update app_private.app_session
  set created_at = v_boundary - interval '31 hours 59 minutes',
      last_seen_at = v_boundary - interval '31 hours',
      idle_expires_at = v_boundary - interval '30 hours 30 minutes',
      absolute_expires_at = v_boundary - interval '23 hours 59 minutes',
      rotate_after = v_boundary - interval '31 hours 44 minutes',
      revoked_at = v_boundary - interval '23 hours 59 minutes',
      revoke_reason = 'logout'
  where id = v_recent_revoked_session;

  for v_index in 1..3 loop
    v_fingerprint := pg_catalog.sha256(
      pg_catalog.convert_to('cleanup-old-throttle-' || v_index::text, 'UTF8')
    );
    insert into app_private.login_throttle (
      scope,
      fingerprint,
      window_started_at,
      attempt_count,
      blocked_until,
      updated_at
    ) values (
      case when v_index % 2 = 0 then 'network' else 'account' end,
      v_fingerprint,
      v_boundary - interval '30 hours' + v_index * interval '1 hour',
      1,
      null,
      v_boundary - interval '30 hours' + v_index * interval '1 hour'
    );
  end loop;

  insert into app_private.login_throttle (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  ) values (
    'account',
    pg_catalog.sha256('cleanup-recent-throttle'::bytea),
    v_boundary - interval '23 hours 59 minutes',
    1,
    null,
    v_boundary - interval '23 hours 59 minutes'
  );

  insert into app_private.login_throttle (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  ) values (
    'network',
    pg_catalog.sha256('cleanup-active-block'::bytea),
    v_boundary - interval '30 hours',
    31,
    v_boundary + interval '5 minutes',
    v_boundary - interval '30 hours'
  );

  begin
    perform public.cleanup_app_sessions(
      null,
      '01901904-0000-4000-8000-000000000001'
    );
    raise exception 'cleanup accepted a null batch limit';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.cleanup_app_sessions(
      -1,
      '01901904-0000-4000-8000-000000000002'
    );
    raise exception 'cleanup accepted a negative batch limit';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.cleanup_app_sessions(
      0,
      '01901900-0000-4000-8000-000000000067'
    );
    raise exception 'cleanup accepted a zero batch limit';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.cleanup_app_sessions(
      1001,
      '01901900-0000-4000-8000-000000000068'
    );
    raise exception 'cleanup accepted a batch limit above 1000';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.cleanup_app_sessions(2, null);
    raise exception 'cleanup accepted a null request ID';
  exception
    when invalid_parameter_value then null;
  end;

  select count(*) into v_session_count
  from app_private.app_session
  where id in (v_idle_session, v_absolute_session, v_revoked_session,
               v_recent_expired_session, v_recent_revoked_session);
  select count(*) into v_throttle_count
  from app_private.login_throttle
  where fingerprint in (
    pg_catalog.sha256('cleanup-old-throttle-1'::bytea),
    pg_catalog.sha256('cleanup-old-throttle-2'::bytea),
    pg_catalog.sha256('cleanup-old-throttle-3'::bytea),
    pg_catalog.sha256('cleanup-recent-throttle'::bytea),
    pg_catalog.sha256('cleanup-active-block'::bytea)
  );
  if v_session_count <> 5 or v_throttle_count <> 5 then
    raise exception 'invalid cleanup request changed retained state';
  end if;

  v_result := public.cleanup_app_sessions(
    2,
    '01901900-0000-4000-8000-000000000069'
  );
  insert into session_foundation_test_response values ('cleanup.first-batch', v_result);
  if v_result <> '{"ok":true,"sessionsDeleted":2,"throttlesDeleted":2}'::jsonb
    or exists (
      select 1 from app_private.app_session
      where id in (v_idle_session, v_absolute_session)
    )
    or not exists (
      select 1 from app_private.app_session where id = v_revoked_session
    )
    or exists (
      select 1 from app_private.app_session_token
      where token_hash in (v_idle_hash, v_absolute_hash)
    )
    or (
      select count(*) from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000069'
        and action = 'session.expired'
        and actor_type = 'system'
        and actor_principal_id is null
        and entity_id in (v_idle_session::text, v_absolute_session::text)
    ) <> 2
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000069'
        and entity_id = v_idle_session::text
        and metadata = '{"reason":"idle_timeout"}'::jsonb
    )
    or not exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000069'
        and entity_id = v_absolute_session::text
        and metadata = '{"reason":"absolute_timeout"}'::jsonb
    )
  then
    raise exception 'first bounded cleanup batch or timeout audit is invalid: %', v_result;
  end if;

  v_result := public.cleanup_app_sessions(
    2,
    '01901900-0000-4000-8000-000000000070'
  );
  insert into session_foundation_test_response values ('cleanup.second-batch', v_result);
  if v_result <> '{"ok":true,"sessionsDeleted":1,"throttlesDeleted":1}'::jsonb
    or exists (
      select 1 from app_private.app_session where id = v_revoked_session
    )
    or exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000070'
        and action = 'session.expired'
    )
    or not exists (
      select 1 from app_private.app_session
      where id = v_recent_expired_session
    )
    or not exists (
      select 1 from app_private.app_session
      where id = v_recent_revoked_session
    )
    or not exists (
      select 1 from app_private.login_throttle
      where fingerprint = pg_catalog.sha256('cleanup-recent-throttle'::bytea)
    )
    or not exists (
      select 1 from app_private.login_throttle
      where fingerprint = pg_catalog.sha256('cleanup-active-block'::bytea)
        and blocked_until > pg_catalog.clock_timestamp()
    )
  then
    raise exception 'second cleanup batch crossed the 24-hour retention boundary: %',
      v_result;
  end if;

  v_result := public.cleanup_app_sessions(
    2,
    '01901900-0000-4000-8000-000000000071'
  );
  insert into session_foundation_test_response values ('cleanup.idempotent', v_result);
  if v_result <> '{"ok":true,"sessionsDeleted":0,"throttlesDeleted":0}'::jsonb
    or exists (
      select 1 from app_private.audit_event
      where request_id = '01901900-0000-4000-8000-000000000071'
    )
  then
    raise exception 'cleanup replay was not empty and audit-idempotent: %', v_result;
  end if;

  v_result := public.cleanup_app_sessions(
    1000,
    '01901904-0000-4000-8000-000000000003'
  );
  if v_result <> '{"ok":true,"sessionsDeleted":0,"throttlesDeleted":0}'::jsonb
    or not exists (
      select 1
      from app_private.login_throttle
      where fingerprint = pg_catalog.sha256('cleanup-active-block'::bytea)
        and blocked_until > pg_catalog.clock_timestamp()
    )
  then
    raise exception 'maximum cleanup limit was rejected or removed an active block: %',
      v_result;
  end if;
end
$test$;

-- Synthetic BEFORE triggers force errors after each RPC has begun mutating its
-- own transaction. Every fixture and trigger is removed by the outer rollback.
create function pg_temp.assert_redacted_session_constraint(
  p_label text,
  p_expected_message text,
  p_error_state text,
  p_error_message text,
  p_error_detail text,
  p_error_hint text,
  p_error_context text,
  p_forbidden_context_fragments text[]
)
returns void
language plpgsql
set search_path = pg_catalog
as $test$
begin
  if p_error_state is distinct from '23514'
    or p_error_message is distinct from p_expected_message
    or coalesce(p_error_detail, '') <> ''
    or coalesce(p_error_hint, '') <> ''
    or coalesce(p_error_context, '') = ''
    or exists (
      select 1
      from pg_catalog.unnest(p_forbidden_context_fragments) fragment(value)
      where pg_catalog.lower(p_error_context)
        like '%' || pg_catalog.lower(fragment.value) || '%'
    )
  then
    raise exception '% constraint diagnostics were not stable and redacted', p_label;
  end if;
end
$test$;

create function pg_temp.reject_session_foundation_audit()
returns trigger
language plpgsql
set search_path = pg_catalog
as $test$
begin
  if new.request_id in (
    '01901905-0000-4000-8000-000000000001'::uuid,
    '01901905-0000-4000-8000-000000000003'::uuid,
    '01901905-0000-4000-8000-000000000005'::uuid,
    '01901905-0000-4000-8000-000000000007'::uuid,
    '01901905-0000-4000-8000-000000000010'::uuid,
    '01901905-0000-4000-8000-000000000012'::uuid
  ) then
    raise exception using
      errcode = '23514',
      message = 'synthetic session audit failure';
  end if;
  return new;
end
$test$;

create trigger session_foundation_test_reject_audit
before insert on app_private.audit_event
for each row execute function pg_temp.reject_session_foundation_audit();

create function pg_temp.reject_session_foundation_network_update()
returns trigger
language plpgsql
set search_path = pg_catalog
as $test$
begin
  if new.scope = 'network'
    and new.fingerprint = pg_catalog.sha256(
      pg_catalog.convert_to('late-throttle-network', 'UTF8')
    )
  then
    raise exception using
      errcode = '23514',
      message = 'synthetic network throttle failure',
      detail = 'fingerprint=' || pg_catalog.encode(new.fingerprint, 'hex'),
      hint = 'fingerprint=' || pg_catalog.encode(new.fingerprint, 'hex');
  end if;
  return new;
end
$test$;

create trigger session_foundation_test_reject_network_update
before update on app_private.login_throttle
for each row execute function pg_temp.reject_session_foundation_network_update();

create function pg_temp.reject_session_foundation_account_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $test$
begin
  if old.scope = 'account'
    and old.fingerprint = pg_catalog.sha256(
      pg_catalog.convert_to('late-clear-account', 'UTF8')
    )
  then
    raise exception using
      errcode = '23514',
      message = 'synthetic account throttle delete failure',
      detail = 'fingerprint=' || pg_catalog.encode(old.fingerprint, 'hex'),
      hint = 'fingerprint=' || pg_catalog.encode(old.fingerprint, 'hex');
  end if;
  return old;
end
$test$;

create trigger session_foundation_test_reject_account_delete
before delete on app_private.login_throttle
for each row execute function pg_temp.reject_session_foundation_account_delete();

do $test$
declare
  v_principal          constant uuid := '01900000-0000-4000-8000-000000000001';
  v_actor              constant uuid := '01900000-0000-4000-8000-000000000004';
  v_bulk_principal     constant uuid := '01900000-0000-4000-8000-000000000007';
  v_create_hash        bytea := pg_catalog.sha256('late-create-token'::bytea);
  v_rotation_hash      bytea := pg_catalog.sha256('late-rotation-token'::bytea);
  v_rotation_next      bytea := pg_catalog.sha256('late-rotation-next'::bytea);
  v_logout_hash        bytea := pg_catalog.sha256('late-logout-token'::bytea);
  v_admin_hash         bytea := pg_catalog.sha256('late-admin-token'::bytea);
  v_bulk_hash_1        bytea := pg_catalog.sha256('late-bulk-token-1'::bytea);
  v_bulk_hash_2        bytea := pg_catalog.sha256('late-bulk-token-2'::bytea);
  v_cleanup_hash       bytea := pg_catalog.sha256('late-cleanup-token'::bytea);
  v_account            bytea := pg_catalog.sha256('late-throttle-account'::bytea);
  v_network            bytea := pg_catalog.sha256('late-throttle-network'::bytea);
  v_clear_account      bytea := pg_catalog.sha256('late-clear-account'::bytea);
  v_rotation_session   uuid;
  v_logout_session     uuid;
  v_admin_session      uuid;
  v_bulk_session_1     uuid;
  v_bulk_session_2     uuid;
  v_cleanup_session    uuid;
  v_before_last_seen   timestamptz;
  v_before_idle        timestamptz;
  v_before_rotate      timestamptz;
  v_boundary           timestamptz;
  v_error_state        text;
  v_error_message      text;
  v_error_detail       text;
  v_error_hint         text;
  v_error_context      text;
begin
  begin
    perform public.create_app_session(
      v_principal,
      v_create_hash,
      '01901905-0000-4000-8000-000000000001'
    );
    raise exception 'synthetic create audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'create',
        'session state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          pg_catalog.left(pg_catalog.encode(v_create_hash, 'hex'), 24)
        ]
      );
  end;
  if exists (
      select 1 from app_private.app_session_token where token_hash = v_create_hash
    )
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901905-0000-4000-8000-000000000001'
    )
  then
    raise exception 'late create failure left session, token, or audit state';
  end if;

  v_rotation_session := (
    public.create_app_session(
      v_principal,
      v_rotation_hash,
      '01901905-0000-4000-8000-000000000002'
    ) ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '1 hour',
      last_seen_at = v_boundary - interval '1 minute',
      idle_expires_at = v_boundary + interval '29 minutes',
      absolute_expires_at = v_boundary + interval '7 hours',
      rotate_after = v_boundary - interval '1 second'
  where id = v_rotation_session;
  select last_seen_at, idle_expires_at, rotate_after
  into v_before_last_seen, v_before_idle, v_before_rotate
  from app_private.app_session
  where id = v_rotation_session;
  begin
    perform public.use_app_session(
      v_rotation_hash,
      v_rotation_next,
      '01901905-0000-4000-8000-000000000003'
    );
    raise exception 'synthetic rotation audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'rotation',
        'session state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          'update app_private.app_session_token',
          pg_catalog.left(pg_catalog.encode(v_rotation_hash, 'hex'), 24),
          pg_catalog.left(pg_catalog.encode(v_rotation_next, 'hex'), 24)
        ]
      );
  end;
  if not exists (
      select 1
      from app_private.app_session_token
      where token_hash = v_rotation_hash
        and session_id = v_rotation_session
        and state = 'current'
    )
    or exists (
      select 1 from app_private.app_session_token where token_hash = v_rotation_next
    )
    or exists (
      select 1
      from app_private.app_session
      where id = v_rotation_session
        and (
          last_seen_at is distinct from v_before_last_seen
          or idle_expires_at is distinct from v_before_idle
          or rotate_after is distinct from v_before_rotate
          or rotation_count <> 0
        )
    )
  then
    raise exception 'late rotation failure left family or token state';
  end if;

  v_logout_session := (
    public.create_app_session(
      v_principal,
      v_logout_hash,
      '01901905-0000-4000-8000-000000000004'
    ) ->> 'sessionId'
  )::uuid;
  begin
    perform public.logout_app_session(
      v_logout_hash,
      '01901905-0000-4000-8000-000000000005'
    );
    raise exception 'synthetic logout audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'logout',
        'session state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          pg_catalog.left(pg_catalog.encode(v_logout_hash, 'hex'), 24)
        ]
      );
  end;
  if exists (
    select 1
    from app_private.app_session
    where id = v_logout_session and revoked_at is not null
  ) then
    raise exception 'late logout failure left the family revoked';
  end if;

  v_admin_session := (
    public.create_app_session(
      v_principal,
      v_admin_hash,
      '01901905-0000-4000-8000-000000000006'
    ) ->> 'sessionId'
  )::uuid;
  begin
    perform public.revoke_app_session(
      v_admin_session,
      v_actor,
      'administrator',
      '01901905-0000-4000-8000-000000000007'
    );
    raise exception 'synthetic administrator audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'single revoke',
        'session state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          pg_catalog.left(pg_catalog.encode(v_admin_hash, 'hex'), 24)
        ]
      );
  end;
  if exists (
    select 1
    from app_private.app_session
    where id = v_admin_session and revoked_at is not null
  ) then
    raise exception 'late administrator failure left the family revoked';
  end if;

  v_bulk_session_1 := (
    public.create_app_session(
      v_bulk_principal,
      v_bulk_hash_1,
      '01901905-0000-4000-8000-000000000008'
    ) ->> 'sessionId'
  )::uuid;
  v_bulk_session_2 := (
    public.create_app_session(
      v_bulk_principal,
      v_bulk_hash_2,
      '01901905-0000-4000-8000-000000000009'
    ) ->> 'sessionId'
  )::uuid;
  begin
    perform public.revoke_principal_sessions(
      v_bulk_principal,
      null,
      v_actor,
      'administrator',
      '01901905-0000-4000-8000-000000000010'
    );
    raise exception 'synthetic bulk audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'bulk revoke',
        'session state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          pg_catalog.left(pg_catalog.encode(v_bulk_hash_1, 'hex'), 24),
          pg_catalog.left(pg_catalog.encode(v_bulk_hash_2, 'hex'), 24)
        ]
      );
  end;
  if (
    select count(*)
    from app_private.app_session
    where id in (v_bulk_session_1, v_bulk_session_2)
      and revoked_at is null
  ) <> 2 then
    raise exception 'late bulk failure partially revoked its families';
  end if;

  begin
    perform public.consume_login_attempt(v_account, v_network);
    raise exception 'synthetic throttle update failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'login throttle',
        'login throttle state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'update app_private.login_throttle',
          pg_catalog.left(pg_catalog.encode(v_account, 'hex'), 24),
          pg_catalog.left(pg_catalog.encode(v_network, 'hex'), 24)
        ]
      );
  end;
  if exists (
    select 1
    from app_private.login_throttle
    where (scope = 'account' and fingerprint = v_account)
       or (scope = 'network' and fingerprint = v_network)
  ) then
    raise exception 'late network throttle failure left a partial dimension';
  end if;

  v_boundary := pg_catalog.clock_timestamp();
  insert into app_private.login_throttle (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  ) values (
    'account',
    v_clear_account,
    v_boundary,
    2,
    null,
    v_boundary
  );
  begin
    perform public.clear_login_account_throttle(v_clear_account);
    raise exception 'synthetic account throttle delete failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'account throttle clear',
        'login throttle state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'delete from app_private.login_throttle',
          pg_catalog.left(pg_catalog.encode(v_clear_account, 'hex'), 24)
        ]
      );
  end;
  if not exists (
    select 1
    from app_private.login_throttle
    where scope = 'account'
      and fingerprint = v_clear_account
      and window_started_at = v_boundary
      and attempt_count = 2
      and blocked_until is null
      and updated_at = v_boundary
  ) then
    raise exception 'late account throttle clear failure deleted or changed state';
  end if;

  v_cleanup_session := (
    public.create_app_session(
      v_principal,
      v_cleanup_hash,
      '01901905-0000-4000-8000-000000000011'
    ) ->> 'sessionId'
  )::uuid;
  v_boundary := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_boundary - interval '34 hours',
      last_seen_at = v_boundary - interval '34 hours',
      idle_expires_at = v_boundary - interval '33 hours 30 minutes',
      absolute_expires_at = v_boundary - interval '26 hours',
      rotate_after = v_boundary - interval '33 hours 45 minutes'
  where id = v_cleanup_session;
  begin
    perform public.cleanup_app_sessions(
      1,
      '01901905-0000-4000-8000-000000000012'
    );
    raise exception 'synthetic cleanup audit failure did not fire';
  exception
    when check_violation then
      get stacked diagnostics
        v_error_state = returned_sqlstate,
        v_error_message = message_text,
        v_error_detail = pg_exception_detail,
        v_error_hint = pg_exception_hint,
        v_error_context = pg_exception_context;
      perform pg_temp.assert_redacted_session_constraint(
        'cleanup',
        'session cleanup state constraint violation',
        v_error_state,
        v_error_message,
        v_error_detail,
        v_error_hint,
        v_error_context,
        array[
          'insert into app_private.audit_event',
          pg_catalog.left(pg_catalog.encode(v_cleanup_hash, 'hex'), 24)
        ]
      );
  end;
  if not exists (
      select 1 from app_private.app_session where id = v_cleanup_session
    )
    or not exists (
      select 1 from app_private.app_session_token where token_hash = v_cleanup_hash
    )
    or exists (
      select 1
      from app_private.audit_event
      where request_id = '01901905-0000-4000-8000-000000000012'
    )
  then
    raise exception 'late cleanup failure deleted state or retained its audit';
  end if;
end
$test$;

drop trigger session_foundation_test_reject_account_delete
  on app_private.login_throttle;
drop trigger session_foundation_test_reject_network_update
  on app_private.login_throttle;
drop trigger session_foundation_test_reject_audit
  on app_private.audit_event;

-- A raw sentinel and even its printable digest must never enter a response or
-- audit envelope. Only the fixed-size binary digest is allowed in token state.
do $test$
declare
  v_secret      constant text := 'session-secret-sentinel-019-create';
  v_digest      bytea := pg_catalog.sha256(pg_catalog.convert_to(v_secret, 'UTF8'));
  v_digest_hex  text := pg_catalog.encode(v_digest, 'hex');
begin
  if exists (
    select 1
    from session_foundation_test_response response
    where response.payload::text like '%' || v_secret || '%'
      or response.payload::text like '%' || v_digest_hex || '%'
  ) then
    raise exception 'a session RPC response exposed raw or digest credential material';
  end if;

  if exists (
    select 1
    from app_private.audit_event audit
    where audit.request_id::text like '01901900-%'
      and (
        audit.action like '%' || v_secret || '%'
        or audit.entity_type like '%' || v_secret || '%'
        or audit.entity_id like '%' || v_secret || '%'
        or audit.metadata::text like '%' || v_secret || '%'
        or audit.action like '%' || v_digest_hex || '%'
        or audit.entity_type like '%' || v_digest_hex || '%'
        or audit.entity_id like '%' || v_digest_hex || '%'
        or audit.metadata::text like '%' || v_digest_hex || '%'
      )
  ) then
    raise exception 'session audit evidence exposed raw or digest credential material';
  end if;

  if not exists (
    select 1 from app_private.app_session_token token
    where token.token_hash = v_digest
      and pg_catalog.octet_length(token.token_hash) = 32
  ) then
    raise exception 'redaction sentinel digest was not retained in hash-only token state';
  end if;
end
$test$;

rollback;

select 'session foundation tests passed' as result;
