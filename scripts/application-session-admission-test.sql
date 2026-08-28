\set ON_ERROR_STOP on

begin;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

-- Freeze the PostgREST signatures, wrapper guards, path pinning, and private
-- implementation boundary before exercising admission state.
do $test$
declare
  v_role             text;
  v_private_function regprocedure;
  v_claims            text;
begin
  if pg_catalog.to_regprocedure(
    'app_private.admit_admin_app_session(text,text,text,bytea,uuid)'
  ) is null
    or pg_catalog.to_regprocedure(
      'public.admit_admin_app_session(text,text,text,bytea,uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'app_private.authorize_admin_principal(uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.authorize_admin_principal(uuid)'
    ) is null
  then
    raise exception 'application-session admission RPC contract is incomplete';
  end if;

  if exists (
    select 1
    from (values
      (
        'admit_admin_app_session',
        array[
          'p_provider', 'p_issuer', 'p_subject', 'p_token_hash', 'p_request_id'
        ]::text[]
      ),
      ('authorize_admin_principal', array['p_principal_id']::text[])
    ) expected(proname, argument_names)
    join pg_catalog.pg_proc routine on routine.proname = expected.proname
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proargnames is distinct from expected.argument_names
  ) then
    raise exception 'application-session RPC argument names drifted';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'app_private'
      and routine.proname in (
        'admit_admin_app_session',
        'authorize_admin_principal'
      )
      and routine.prosecdef
  ) then
    raise exception 'a private admission routine uses definer rights';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'admit_admin_app_session',
        'authorize_admin_principal'
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
    raise exception 'a public admission wrapper is not guarded and path-pinned';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.proname in (
        'admit_admin_app_session',
        'authorize_admin_principal'
      )
      and pg_catalog.obj_description(routine.oid, 'pg_proc') is null
  ) then
    raise exception 'a public admission wrapper lacks a contract comment';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'club_admin', 'service_role'] loop
    continue when not exists (
      select 1 from pg_catalog.pg_roles where rolname = v_role
    );

    if pg_catalog.has_schema_privilege(v_role, 'app_private', 'usage') then
      raise exception 'an application role can use the private admission schema';
    end if;

    for v_private_function in
      select routine.oid::regprocedure
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace
        on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app_private'
        and routine.proname in (
          'admit_admin_app_session',
          'authorize_admin_principal'
        )
    loop
      if pg_catalog.has_function_privilege(
        v_role,
        v_private_function,
        'execute'
      ) then
        raise exception 'an application role can execute a private admission routine';
      end if;
    end loop;

    if v_role in ('club_admin', 'service_role') then
      if not pg_catalog.has_function_privilege(
        v_role,
        'public.admit_admin_app_session(text,text,text,bytea,uuid)',
        'execute'
      ) or not pg_catalog.has_function_privilege(
        v_role,
        'public.authorize_admin_principal(uuid)',
        'execute'
      ) then
        raise exception 'a trusted transport role cannot reach guarded admission wrappers';
      end if;
    elsif pg_catalog.has_function_privilege(
      v_role,
      'public.admit_admin_app_session(text,text,text,bytea,uuid)',
      'execute'
    ) or pg_catalog.has_function_privilege(
      v_role,
      'public.authorize_admin_principal(uuid)',
      'execute'
    ) then
      raise exception 'an untrusted role can execute trusted admission wrappers';
    end if;
  end loop;

  -- PostgreSQL ownership never bypasses the in-body gateway claim guard.
  foreach v_claims in array array[
    '',
    '{malformed-json',
    '{"role":"anon"}',
    '{"role":"authenticated"}',
    '{"role":"club_admin"}'
  ] loop
    perform pg_catalog.set_config('request.jwt.claims', v_claims, true);

    begin
      perform public.admit_admin_app_session(
        'cloudbase',
        'https://admission-guard.example',
        'guard-subject',
        pg_catalog.sha256('guard-token'::bytea),
        '02002000-0000-4000-8000-000000000001'
      );
      raise exception 'untrusted claims reached administrator admission';
    exception
      when insufficient_privilege then null;
    end;

    begin
      perform public.authorize_admin_principal(
        '02000000-0000-4000-8000-000000000001'
      );
      raise exception 'untrusted claims reached administrator authorization';
    exception
      when insufficient_privilege then null;
    end;
  end loop;

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
end
$test$;

-- A first admission checks the exact legacy allowlist before creating an
-- identity, links the bridge, and returns only the stable 019 session fields.
-- Repeating the same binding reuses its Principal and creates one new family.
do $test$
declare
  v_provider          constant text := 'cloudbase';
  v_issuer            constant text := 'https://admission-fresh.example';
  v_subject           constant text := 'AdmissionFreshAdmin';
  v_secret_one        constant text := 'admission-fresh-secret-one';
  v_secret_two        constant text := 'admission-fresh-secret-two';
  v_digest_one        bytea := pg_catalog.sha256(
    pg_catalog.convert_to(v_secret_one, 'UTF8')
  );
  v_digest_two        bytea := pg_catalog.sha256(
    pg_catalog.convert_to(v_secret_two, 'UTF8')
  );
  v_first             jsonb;
  v_repeat            jsonb;
  v_principal_id      uuid;
  v_session_id        uuid;
  v_last_verified_at  timestamptz;
begin
  insert into public.admin_user (user_id, note)
  values (v_subject, '020 fresh admission fixture');

  v_first := public.admit_admin_app_session(
    v_provider,
    v_issuer,
    v_subject,
    v_digest_one,
    '02002000-0000-4000-8000-000000000010'
  );

  if not coalesce((v_first ->> 'ok')::boolean, false)
    or (
      select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(v_first) key
    ) is distinct from array[
      'absoluteExpiresAt',
      'idleExpiresAt',
      'ok',
      'principalId',
      'rotateAfter',
      'sessionId'
    ]::text[]
  then
    raise exception 'fresh admission returned an unstable envelope';
  end if;

  v_principal_id := (v_first ->> 'principalId')::uuid;
  v_session_id := (v_first ->> 'sessionId')::uuid;

  if v_principal_id is null
    or v_session_id is null
    or (select principal_id from public.admin_user where user_id = v_subject)
       is distinct from v_principal_id
    or not exists (
      select 1
      from app_private.principal principal
      where principal.id = v_principal_id
        and principal.status = 'active'
    )
    or not exists (
      select 1
      from app_private.principal_identity identity
      where identity.principal_id = v_principal_id
        and identity.provider = v_provider collate "C"
        and identity.issuer = v_issuer collate "C"
        and identity.subject = v_subject collate "C"
    )
    or not exists (
      select 1
      from app_private.app_session session_row
      join app_private.app_session_token token
        on token.session_id = session_row.id
      where session_row.id = v_session_id
        and session_row.principal_id = v_principal_id
        and token.token_hash = v_digest_one
        and token.state = 'current'
        and (v_first ->> 'idleExpiresAt')::timestamptz =
            session_row.idle_expires_at
        and (v_first ->> 'absoluteExpiresAt')::timestamptz =
            session_row.absolute_expires_at
        and (v_first ->> 'rotateAfter')::timestamptz = session_row.rotate_after
    )
  then
    raise exception 'fresh admission did not atomically persist its binding/session';
  end if;

  select identity.last_verified_at
  into v_last_verified_at
  from app_private.principal_identity identity
  where identity.principal_id = v_principal_id;

  v_repeat := public.admit_admin_app_session(
    v_provider,
    v_issuer,
    v_subject,
    v_digest_two,
    '02002000-0000-4000-8000-000000000011'
  );

  if not coalesce((v_repeat ->> 'ok')::boolean, false)
    or (v_repeat ->> 'principalId')::uuid <> v_principal_id
    or (v_repeat ->> 'sessionId')::uuid = v_session_id
    or (
      select count(*)
      from app_private.principal_identity identity
      where identity.provider = v_provider collate "C"
        and identity.issuer = v_issuer collate "C"
        and identity.subject = v_subject collate "C"
    ) <> 1
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
    ) <> 2
    or (
      select identity.last_verified_at
      from app_private.principal_identity identity
      where identity.principal_id = v_principal_id
    ) < v_last_verified_at
  then
    raise exception 'same-binding admission is not identity-idempotent';
  end if;

  if v_first::text like '%' || v_secret_one || '%'
    or v_repeat::text like '%' || v_secret_two || '%'
    or exists (
      select 1
      from app_private.audit_event audit
      where audit.actor_principal_id = v_principal_id
         or (
           audit.action = 'principal.created'
           and audit.entity_id = v_principal_id::text
         )
      group by audit.id
      having pg_catalog.concat_ws(
        ' ',
        audit.action,
        audit.entity_type,
        audit.entity_id,
        audit.metadata::text
      ) like any(array[
        '%' || v_provider || '%',
        '%' || v_issuer || '%',
        '%' || v_subject || '%',
        '%' || pg_catalog.encode(v_digest_one, 'hex') || '%',
        '%' || pg_catalog.encode(v_digest_two, 'hex') || '%'
      ])
    )
  then
    raise exception 'admission response or audit leaked identity/credential material';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.action = 'principal.created'
      and audit.entity_id = v_principal_id::text
      and audit.metadata = '{}'::jsonb
  ) <> 1
    or (
      select count(*)
      from app_private.audit_event audit
      where audit.action = 'session.created'
        and audit.actor_principal_id = v_principal_id
        and audit.metadata = '{}'::jsonb
    ) <> 2
  then
    raise exception 'admission audit evidence is missing or over-duplicated';
  end if;
end
$test$;

-- Unknown and case-variant subjects are one generic denial and never create an
-- identity, Principal, session, token, link, or audit row.
do $test$
declare
  v_result          jsonb;
  v_principal_count bigint;
  v_identity_count  bigint;
  v_session_count   bigint;
  v_token_count     bigint;
  v_audit_count     bigint;
begin
  select count(*) into v_principal_count from app_private.principal;
  select count(*) into v_identity_count from app_private.principal_identity;
  select count(*) into v_session_count from app_private.app_session;
  select count(*) into v_token_count from app_private.app_session_token;
  select count(*) into v_audit_count from app_private.audit_event;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-unknown.example',
    'UnknownAdmissionAdmin',
    pg_catalog.sha256('unknown-admission-token'::bytea),
    '02002000-0000-4000-8000-000000000020'
  );

  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'unknown administrator did not receive the generic denial';
  end if;

  insert into public.admin_user (user_id, note)
  values ('CaseExactAdmissionAdmin', '020 exact subject fixture');

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-case.example',
    'caseexactadmissionadmin',
    pg_catalog.sha256('case-admission-token'::bytea),
    '02002000-0000-4000-8000-000000000021'
  );

  if v_result is distinct from '{"ok":false}'::jsonb
    or (select count(*) from app_private.principal) <> v_principal_count
    or (select count(*) from app_private.principal_identity) <> v_identity_count
    or (select count(*) from app_private.app_session) <> v_session_count
    or (select count(*) from app_private.app_session_token) <> v_token_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
    or exists (
      select 1
      from public.admin_user
      where user_id = 'CaseExactAdmissionAdmin'
        and principal_id is not null
    )
  then
    raise exception 'unknown/exact-subject denial changed admission state';
  end if;
end
$test$;

-- Suspended/deleted identities and a bridge tuple conflict all collapse to the
-- same response. The subtransaction must undo verification touches, links, and
-- any identity/Principal/audit rows created before the denial was discovered.
do $test$
declare
  v_suspended_subject constant text := 'AdmissionSuspendedAdmin';
  v_deleted_subject   constant text := 'AdmissionDeletedAdmin';
  v_conflict_subject  constant text := 'AdmissionConflictAdmin';
  v_suspended         uuid;
  v_deleted           uuid;
  v_conflict          uuid;
  v_verified_at       timestamptz;
  v_principal_count   bigint;
  v_identity_count    bigint;
  v_session_count     bigint;
  v_audit_count       bigint;
  v_result            jsonb;
begin
  insert into public.admin_user (user_id, note) values
    (v_suspended_subject, '020 suspended fixture'),
    (v_deleted_subject, '020 deleted fixture'),
    (v_conflict_subject, '020 conflict fixture');

  v_suspended := (
    public.ensure_principal_identity(
      'cloudbase',
      'https://admission-suspended.example',
      v_suspended_subject
    ) ->> 'principalId'
  )::uuid;
  update app_private.principal
  set status = 'suspended'
  where id = v_suspended;
  select last_verified_at into v_verified_at
  from app_private.principal_identity
  where principal_id = v_suspended;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-suspended.example',
    v_suspended_subject,
    pg_catalog.sha256('suspended-admission-token'::bytea),
    '02002000-0000-4000-8000-000000000030'
  );

  if v_result is distinct from '{"ok":false}'::jsonb
    or exists (
      select 1 from public.admin_user
      where user_id = v_suspended_subject and principal_id is not null
    )
    or (
      select last_verified_at
      from app_private.principal_identity
      where principal_id = v_suspended
    ) is distinct from v_verified_at
    or exists (
      select 1 from app_private.app_session where principal_id = v_suspended
    )
  then
    raise exception 'suspended admission denial did not roll back its mutations';
  end if;

  v_deleted := (
    public.ensure_principal_identity(
      'cloudbase',
      'https://admission-deleted.example',
      v_deleted_subject
    ) ->> 'principalId'
  )::uuid;
  update app_private.principal
  set status = 'deleted', deleted_at = pg_catalog.clock_timestamp()
  where id = v_deleted;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-deleted.example',
    v_deleted_subject,
    pg_catalog.sha256('deleted-admission-token'::bytea),
    '02002000-0000-4000-8000-000000000031'
  );

  if v_result is distinct from '{"ok":false}'::jsonb
    or exists (
      select 1 from public.admin_user
      where user_id = v_deleted_subject and principal_id is not null
    )
    or exists (
      select 1 from app_private.app_session where principal_id = v_deleted
    )
  then
    raise exception 'deleted admission denial changed bridge/session state';
  end if;

  v_conflict := (
    public.ensure_principal_identity(
      'cloudbase',
      'https://admission-conflict-bound.example',
      v_conflict_subject
    ) ->> 'principalId'
  )::uuid;
  update public.admin_user
  set principal_id = v_conflict
  where user_id = v_conflict_subject;

  select count(*) into v_principal_count from app_private.principal;
  select count(*) into v_identity_count from app_private.principal_identity;
  select count(*) into v_session_count from app_private.app_session;
  select count(*) into v_audit_count from app_private.audit_event;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-conflict-other.example',
    v_conflict_subject,
    pg_catalog.sha256('conflict-admission-token'::bytea),
    '02002000-0000-4000-8000-000000000032'
  );

  if v_result is distinct from '{"ok":false}'::jsonb
    or (select count(*) from app_private.principal) <> v_principal_count
    or (select count(*) from app_private.principal_identity) <> v_identity_count
    or (select count(*) from app_private.app_session) <> v_session_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
    or exists (
      select 1
      from app_private.principal_identity identity
      where identity.provider = 'cloudbase' collate "C"
        and identity.issuer = 'https://admission-conflict-other.example' collate "C"
        and identity.subject = v_conflict_subject collate "C"
    )
    or (
      select principal_id from public.admin_user
      where user_id = v_conflict_subject
    ) is distinct from v_conflict
  then
    raise exception 'bridge conflict was not atomically and generically denied';
  end if;
end
$test$;

-- A late token collision is an operational failure, not a generic admission
-- denial. The failed statement must still roll back the newly created
-- Principal, identity, administrator bridge, and audit rows while retaining
-- the pre-existing owner of that digest.
do $test$
declare
  v_subject         constant text := 'AdmissionLateFailureAdmin';
  v_issuer          constant text := 'https://admission-late-failure.example';
  v_digest          bytea := pg_catalog.sha256(
    'admission-late-failure-existing-token'::bytea
  );
  v_holder          uuid;
  v_principal_count bigint;
  v_identity_count  bigint;
  v_session_count   bigint;
  v_token_count     bigint;
  v_audit_count     bigint;
begin
  v_holder := (
    public.ensure_principal_identity(
      'migration_test',
      'https://admission-late-failure-holder.example',
      'AdmissionLateFailureHolder'
    ) ->> 'principalId'
  )::uuid;
  perform public.create_app_session(
    v_holder,
    v_digest,
    '02002000-0000-4000-8000-000000000040'
  );
  insert into public.admin_user (user_id, note)
  values (v_subject, '020 late operational failure fixture');

  select count(*) into v_principal_count from app_private.principal;
  select count(*) into v_identity_count from app_private.principal_identity;
  select count(*) into v_session_count from app_private.app_session;
  select count(*) into v_token_count from app_private.app_session_token;
  select count(*) into v_audit_count from app_private.audit_event;

  begin
    perform public.admit_admin_app_session(
      'cloudbase',
      v_issuer,
      v_subject,
      v_digest,
      '02002000-0000-4000-8000-000000000041'
    );
    raise exception 'late admission token collision was accepted';
  exception
    when unique_violation then
      if sqlerrm <> 'session digest already exists'
        or sqlerrm like '%' || pg_catalog.encode(v_digest, 'hex') || '%'
      then
        raise exception 'late admission failure leaked an unstable diagnostic';
      end if;
  end;

  if (select count(*) from app_private.principal) <> v_principal_count
    or (select count(*) from app_private.principal_identity) <> v_identity_count
    or (select count(*) from app_private.app_session) <> v_session_count
    or (select count(*) from app_private.app_session_token) <> v_token_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
    or exists (
      select 1
      from app_private.principal_identity identity
      where identity.provider = 'cloudbase' collate "C"
        and identity.issuer = v_issuer collate "C"
        and identity.subject = v_subject collate "C"
    )
    or exists (
      select 1
      from public.admin_user admin
      where admin.user_id collate "C" = v_subject collate "C"
        and admin.principal_id is not null
    )
    or exists (
      select 1
      from app_private.audit_event audit
      where audit.request_id = '02002000-0000-4000-8000-000000000041'
    )
    or not exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = v_digest
        and token.session_id in (
          select session_row.id
          from app_private.app_session session_row
          where session_row.principal_id = v_holder
        )
    )
  then
    raise exception 'late admission failure did not roll back atomically';
  end if;
end
$test$;

-- Five live families are admitted; the sixth is denied without a token or
-- audit row. Once one family is revoked it no longer consumes the live cap.
do $test$
declare
  v_subject       constant text := 'AdmissionCapAdmin';
  v_principal_id  uuid;
  v_first_digest  bytea;
  v_sixth_digest  bytea := pg_catalog.sha256('admission-cap-token-6'::bytea);
  v_result        jsonb;
  v_index         integer;
begin
  insert into public.admin_user (user_id, note)
  values (v_subject, '020 exact five-family cap fixture');

  for v_index in 1..5 loop
    v_result := public.admit_admin_app_session(
      'cloudbase',
      'https://admission-cap.example',
      v_subject,
      pg_catalog.sha256(('admission-cap-token-' || v_index)::bytea),
      pg_catalog.gen_random_uuid()
    );

    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'a live family was denied before the cap';
    end if;

    v_principal_id := coalesce(
      v_principal_id,
      (v_result ->> 'principalId')::uuid
    );
    if (v_result ->> 'principalId')::uuid <> v_principal_id then
      raise exception 'cap admissions did not reuse one Principal';
    end if;
  end loop;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-cap.example',
    v_subject,
    v_sixth_digest,
    '02002000-0000-4000-8000-000000000046'
  );

  if v_result is distinct from '{"ok":false}'::jsonb
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
        and session_row.revoked_at is null
        and session_row.idle_expires_at > pg_catalog.clock_timestamp()
        and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
    ) <> 5
    or exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = v_sixth_digest
    )
    or exists (
      select 1
      from app_private.audit_event audit
      where audit.request_id = '02002000-0000-4000-8000-000000000046'
    )
  then
    raise exception 'sixth live family was not atomically denied';
  end if;

  select token.token_hash
  into v_first_digest
  from app_private.app_session_token token
  join app_private.app_session session_row on session_row.id = token.session_id
  where session_row.principal_id = v_principal_id
    and token.state = 'current'
  order by session_row.created_at, session_row.id
  limit 1;

  perform public.logout_app_session(
    v_first_digest,
    '02002000-0000-4000-8000-000000000047'
  );

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-cap.example',
    v_subject,
    pg_catalog.sha256('admission-cap-token-7'::bytea),
    '02002000-0000-4000-8000-000000000048'
  );

  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
        and session_row.revoked_at is null
        and session_row.idle_expires_at > pg_catalog.clock_timestamp()
        and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
    ) <> 5
  then
    raise exception 'revoked family did not release one live admission slot';
  end if;
end
$test$;

-- Five unrevoked families whose idle and absolute deadlines are at the sampled
-- boundary no longer consume the cap, even before physical cleanup.
do $test$
declare
  v_subject      constant text := 'AdmissionExpiredCapAdmin';
  v_principal_id uuid;
  v_result       jsonb;
  v_expiry       timestamptz;
  v_index        integer;
begin
  insert into public.admin_user (user_id, note)
  values (v_subject, '020 expired family cap fixture');

  for v_index in 1..5 loop
    v_result := public.admit_admin_app_session(
      'cloudbase',
      'https://admission-expired-cap.example',
      v_subject,
      pg_catalog.sha256(('admission-expired-cap-token-' || v_index)::bytea),
      pg_catalog.gen_random_uuid()
    );
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'expired-cap fixture admission failed';
    end if;
    v_principal_id := coalesce(
      v_principal_id,
      (v_result ->> 'principalId')::uuid
    );
  end loop;

  v_expiry := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_expiry - interval '8 hours',
      last_seen_at = v_expiry - interval '30 minutes',
      idle_expires_at = v_expiry,
      absolute_expires_at = v_expiry,
      rotate_after = v_expiry - interval '7 hours 45 minutes'
  where principal_id = v_principal_id;

  v_result := public.admit_admin_app_session(
    'cloudbase',
    'https://admission-expired-cap.example',
    v_subject,
    pg_catalog.sha256('admission-expired-cap-token-6'::bytea),
    '02002000-0000-4000-8000-000000000049'
  );

  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
    ) <> 6
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
        and session_row.revoked_at is null
        and session_row.idle_expires_at > pg_catalog.clock_timestamp()
        and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
    ) <> 1
  then
    raise exception 'deadline-equality families incorrectly consumed the cap';
  end if;
end
$test$;

-- Authorization is based only on a linked, active administrator Principal and
-- always returns the same non-enumerating two-field envelope.
do $test$
declare
  v_active_subject    constant text := 'AdmissionAuthorizeActive';
  v_suspended_subject constant text := 'AdmissionAuthorizeSuspended';
  v_active            uuid;
  v_suspended         uuid;
  v_result            jsonb;
begin
  insert into public.admin_user (user_id, note) values
    (v_active_subject, '020 authorization active fixture'),
    (v_suspended_subject, '020 authorization suspended fixture');

  v_active := (
    public.admit_admin_app_session(
      'cloudbase',
      'https://admission-authorize.example',
      v_active_subject,
      pg_catalog.sha256('authorization-active-token'::bytea),
      '02002000-0000-4000-8000-000000000050'
    ) ->> 'principalId'
  )::uuid;

  v_suspended := (
    public.ensure_principal_identity(
      'cloudbase',
      'https://admission-authorize.example',
      v_suspended_subject
    ) ->> 'principalId'
  )::uuid;
  update public.admin_user
  set principal_id = v_suspended
  where user_id = v_suspended_subject;
  update app_private.principal
  set status = 'suspended'
  where id = v_suspended;

  v_result := public.authorize_admin_principal(v_active);
  if v_result is distinct from '{"ok":true,"authorized":true}'::jsonb then
    raise exception 'active linked administrator was not authorized';
  end if;

  foreach v_result in array array[
    public.authorize_admin_principal(v_suspended),
    public.authorize_admin_principal(
      '02000000-0000-4000-8000-000000000099'
    ),
    public.authorize_admin_principal(null)
  ] loop
    if v_result is distinct from '{"ok":true,"authorized":false}'::jsonb then
      raise exception 'non-authorized Principal returned an unstable envelope';
    end if;
  end loop;

  update app_private.principal
  set status = 'suspended'
  where id = v_active;

  if public.authorize_admin_principal(v_active)
     is distinct from '{"ok":true,"authorized":false}'::jsonb
  then
    raise exception 'authorization ignored a Principal status change';
  end if;
end
$test$;

-- Invalid transport values retain the redacted 019 diagnostics; expected
-- identity/authorization denials above never throw a tuple-bearing error.
do $test$
begin
  begin
    perform public.admit_admin_app_session(
      'cloudbase',
      'https://admission-invalid.example',
      'InvalidAdmissionAdmin',
      pg_catalog.decode(pg_catalog.repeat('aa', 31), 'hex'),
      '02002000-0000-4000-8000-000000000060'
    );
    raise exception '31-byte admission digest was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'invalid session digest' then
        raise exception 'admission digest diagnostic drifted';
      end if;
  end;

  begin
    perform public.admit_admin_app_session(
      'cloudbase',
      'https://admission-invalid.example',
      'InvalidAdmissionAdmin',
      pg_catalog.sha256('invalid-request-token'::bytea),
      null
    );
    raise exception 'null admission request ID was accepted';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'session request ID is required' then
        raise exception 'admission request diagnostic drifted';
      end if;
  end;
end
$test$;

rollback;

\echo 'application session admission SQL tests passed'
