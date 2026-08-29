\set ON_ERROR_STOP on

begin;

do $contract$
declare
  v_private_table text;
  v_retired_rpc text;
  v_role text;
  v_rpc text;
begin
  if to_regclass('app_private.local_admin_credential') is null then
    raise exception 'the local administrator credential table is missing';
  end if;

  if not coalesce((
    select relation.relrowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'app_private.local_admin_credential'::regclass
  ), false) then
    raise exception 'the local administrator credential table does not enforce RLS';
  end if;

  foreach v_rpc in array array[
    'public.begin_local_admin_login(bytea,bytea,text)',
    'public.create_local_admin_session(uuid,bigint,bytea,bytea,uuid)',
    'public.use_local_admin_session(bytea,uuid)',
    'public.end_local_admin_session(bytea,uuid)'
  ] loop
    if to_regprocedure(v_rpc) is null then
      raise exception 'local administrator RPC % is missing', v_rpc;
    end if;

    if not (
      select routine.prosecdef
      from pg_catalog.pg_proc routine
      where routine.oid = to_regprocedure(v_rpc)
    ) then
      raise exception 'local administrator RPC % is not SECURITY DEFINER', v_rpc;
    end if;

    if has_function_privilege('public', v_rpc, 'execute') then
      raise exception 'local administrator RPC % is executable by PUBLIC', v_rpc;
    end if;

    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = v_role)
        and has_function_privilege(v_role, v_rpc, 'execute')
      then
        raise exception 'local administrator RPC % is executable by %', v_rpc, v_role;
      end if;
    end loop;

    foreach v_role in array array['club_admin', 'service_role'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = v_role)
        and not has_function_privilege(v_role, v_rpc, 'execute')
      then
        raise exception 'local administrator RPC % is not executable by %', v_rpc, v_role;
      end if;
    end loop;
  end loop;

  foreach v_retired_rpc in array array[
    'public.admit_admin_app_session(text,text,text,bytea,uuid)',
    'public.authorize_admin_principal(uuid)',
    'public.create_app_session(uuid,bytea,uuid)',
    'public.use_app_session(bytea,bytea,uuid)',
    'public.logout_app_session(bytea,uuid)',
    'public.revoke_app_session(uuid,uuid,text,uuid)',
    'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)',
    'public.consume_login_attempt(bytea,bytea)',
    'public.clear_login_account_throttle(bytea)',
    'public.cleanup_app_sessions(integer,uuid)',
    'public.ensure_principal_identity(text,text,text)'
  ] loop
    if to_regprocedure(v_retired_rpc) is not null then
      raise exception 'retired provider-neutral RPC % remains exposed', v_retired_rpc;
    end if;
  end loop;

  foreach v_private_table in array array[
    'app_private.local_admin_credential',
    'app_private.principal',
    'app_private.audit_event',
    'app_private.app_session',
    'app_private.app_session_token',
    'app_private.login_throttle'
  ] loop
    if has_table_privilege(
      'public',
      v_private_table,
      'select,insert,update,delete,truncate,references,trigger'
    ) then
      raise exception 'private table % is reachable by PUBLIC', v_private_table;
    end if;

    foreach v_role in array array['anon', 'authenticated', 'club_admin', 'service_role'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = v_role)
        and has_table_privilege(
          v_role,
          v_private_table,
          'select,insert,update,delete,truncate,references,trigger'
        )
      then
        raise exception 'private table % is reachable by %', v_private_table, v_role;
      end if;
    end loop;
  end loop;

  foreach v_role in array array['anon', 'authenticated', 'club_admin', 'service_role'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      if has_schema_privilege(v_role, 'app_private', 'usage') then
        raise exception 'private schema is reachable by %', v_role;
      end if;
      if has_function_privilege(
        v_role,
        'app_private.set_local_admin_credential(text,text,integer,bytea,bytea,uuid)',
        'execute'
      ) then
        raise exception 'credential mutation is reachable by %', v_role;
      end if;
    end if;
  end loop;

  if has_function_privilege(
    'public',
    'app_private.set_local_admin_credential(text,text,integer,bytea,bytea,uuid)',
    'execute'
  ) then
    raise exception 'credential mutation is reachable by PUBLIC';
  end if;
end
$contract$;

do $role_setup$
begin
  if not exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'cs2cup_local_admin_auth_test'
  ) then
    create role cs2cup_local_admin_auth_test
      login nosuperuser nocreatedb nocreaterole inherit noreplication nobypassrls;
  end if;
end
$role_setup$;

grant club_admin to cs2cup_local_admin_auth_test;
set session authorization cs2cup_local_admin_auth_test;

do $runtime_role$
declare
  v_account_fingerprint bytea := pg_catalog.sha256(
    pg_catalog.convert_to('local-admin-runtime-account', 'UTF8')
  );
  v_network_fingerprint bytea := pg_catalog.sha256(
    pg_catalog.convert_to('local-admin-runtime-network', 'UTF8')
  );
  v_result jsonb;
  v_token_hash bytea := pg_catalog.sha256(
    pg_catalog.convert_to('local-admin-runtime-token', 'UTF8')
  );
begin
  if not pg_catalog.pg_has_role(session_user, 'club_admin', 'member') then
    raise exception 'the runtime test login does not inherit club_admin';
  end if;

  begin
    perform count(*) from app_private.local_admin_credential;
    raise exception 'the runtime login reached private credential rows';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform app_private.set_local_admin_credential(
      'forbidden-runtime-admin',
      'pbkdf2-hmac-sha256',
      600000,
      pg_catalog.decode(pg_catalog.repeat('00', 16), 'hex'),
      pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
      pg_catalog.gen_random_uuid()
    );
    raise exception 'the runtime login reached private credential mutation';
  exception
    when insufficient_privilege then null;
  end;

  v_result := public.begin_local_admin_login(
    v_account_fingerprint,
    v_network_fingerprint,
    'missing-runtime-administrator'
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or not coalesce((v_result ->> 'allowed')::boolean, false)
    or pg_catalog.jsonb_typeof(v_result -> 'credential') <> 'object'
  then
    raise exception 'the runtime login could not reach login admission: %', v_result;
  end if;

  v_result := public.create_local_admin_session(
    '00000000-0000-4000-8000-000000000000'::uuid,
    1,
    v_token_hash,
    v_account_fingerprint,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'the runtime login received unsafe sentinel admission: %', v_result;
  end if;

  v_result := public.use_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'the runtime login received an unsafe missing session: %', v_result;
  end if;

  v_result := public.end_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":true,"revoked":false}'::jsonb then
    raise exception 'the runtime login could not reach idempotent logout: %', v_result;
  end if;
end
$runtime_role$;

reset session authorization;

do $behavior$
declare
  v_absolute_after timestamptz;
  v_absolute_before timestamptz;
  v_account_fingerprint bytea;
  v_account_limit_fingerprint bytea;
  v_created_at timestamptz;
  v_cleanup_now timestamptz;
  v_cleanup_session_id uuid;
  v_cleanup_throttle_fingerprint bytea;
  v_credential jsonb;
  v_credential_keys text[];
  v_first_updated_at timestamptz;
  v_hash_1 bytea := pg_catalog.sha256(
    pg_catalog.convert_to('local-admin-auth-first-verifier', 'UTF8')
  );
  v_hash_2 bytea := pg_catalog.sha256(
    pg_catalog.convert_to('local-admin-auth-rotated-verifier', 'UTF8')
  );
  v_idle_after timestamptz;
  v_idle_before timestamptz;
  v_known_result jsonb;
  v_last_seen_after timestamptz;
  v_last_seen_before timestamptz;
  v_logout_request uuid := pg_catalog.gen_random_uuid();
  v_network_fingerprint bytea;
  v_network_limit_fingerprint bytea;
  v_principal_id uuid;
  v_provision_request uuid := pg_catalog.gen_random_uuid();
  v_result jsonb;
  v_result_keys text[];
  v_rotate_request uuid := pg_catalog.gen_random_uuid();
  v_salt_1 bytea := pg_catalog.decode(
    '00112233445566778899aabbccddeeff',
    'hex'
  );
  v_salt_2 bytea := pg_catalog.decode(
    'ffeeddccbbaa99887766554433221100',
    'hex'
  );
  v_session_id_1 uuid;
  v_session_id_2 uuid;
  v_session_request_1 uuid := pg_catalog.gen_random_uuid();
  v_token_hash bytea;
  v_unknown_result jsonb;
  v_username text := pg_catalog.format(
    'local-admin-auth-test-%s@example.invalid',
    pg_catalog.pg_backend_pid()
  );
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );

  begin
    perform app_private.set_local_admin_credential(
      v_username,
      'pbkdf2-hmac-sha256',
      600001,
      v_salt_1,
      v_hash_1,
      pg_catalog.gen_random_uuid()
    );
    raise exception 'a per-account password work factor was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  v_result := app_private.set_local_admin_credential(
    v_username,
    'pbkdf2-hmac-sha256',
    600000,
    v_salt_1,
    v_hash_1,
    v_provision_request
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or not coalesce((v_result ->> 'credentialCreated')::boolean, false)
    or not coalesce((v_result ->> 'principalCreated')::boolean, false)
    or (v_result ->> 'principalId') is null
  then
    raise exception 'credential provisioning returned an invalid response: %', v_result;
  end if;
  v_principal_id := (v_result ->> 'principalId')::uuid;

  select credential.created_at, credential.updated_at
  into v_created_at, v_first_updated_at
  from app_private.local_admin_credential credential
  where credential.principal_id = v_principal_id
    and credential.username = v_username
    and credential.password_algorithm = 'pbkdf2-hmac-sha256'
    and credential.password_iterations = 600000
    and credential.password_salt = v_salt_1
    and credential.password_hash = v_hash_1
    and credential.credential_version = 1;
  if not found then
    raise exception 'credential provisioning did not persist the expected verifier';
  end if;

  if not exists (
    select 1
    from public.admin_user administrator
    where administrator.user_id = v_username collate "C"
      and administrator.principal_id = v_principal_id
  ) then
    raise exception 'credential provisioning did not link the administrator principal';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.request_id = v_provision_request
      and audit.action = 'principal.created'
      and audit.entity_type = 'principal'
      and audit.entity_id = v_principal_id::text
      and audit.actor_type = 'system'
      and audit.actor_principal_id is null
      and audit.metadata = '{"source":"local_admin_provisioning"}'::jsonb
  ) <> 1 then
    raise exception 'credential provisioning did not write its principal audit event';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.request_id = v_provision_request
      and audit.action = 'credential.changed'
      and audit.entity_type = 'credential'
      and audit.entity_id = v_principal_id::text
      and audit.actor_type = 'system'
      and audit.actor_principal_id is null
      and audit.metadata = pg_catalog.jsonb_build_object(
        'created', true,
        'algorithm', 'pbkdf2-hmac-sha256',
        'iterations', 600000
      )
  ) <> 1 then
    raise exception 'credential provisioning did not write its credential audit event';
  end if;

  v_account_fingerprint := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':known-account', 'UTF8')
  );
  v_network_fingerprint := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':known-network', 'UTF8')
  );
  v_known_result := public.begin_local_admin_login(
    v_account_fingerprint,
    v_network_fingerprint,
    v_username
  );
  if not coalesce((v_known_result ->> 'ok')::boolean, false)
    or not coalesce((v_known_result ->> 'allowed')::boolean, false)
    or pg_catalog.jsonb_typeof(v_known_result -> 'credential') <> 'object'
  then
    raise exception 'known administrator verifier lookup failed: %', v_known_result;
  end if;

  select pg_catalog.array_agg(key collate "C" order by key collate "C")
  into v_result_keys
  from pg_catalog.jsonb_object_keys(v_known_result) keys(key);
  if v_result_keys is distinct from array['allowed', 'credential', 'ok']::text[] then
    raise exception 'known verifier response has unexpected keys: %', v_result_keys;
  end if;

  v_credential := v_known_result -> 'credential';
  select pg_catalog.array_agg(key collate "C" order by key collate "C")
  into v_credential_keys
  from pg_catalog.jsonb_object_keys(v_credential) keys(key);
  if v_credential_keys is distinct from array[
    'algorithm',
    'credentialVersion',
    'hashHex',
    'iterations',
    'principalId',
    'saltHex',
    'username'
  ]::text[] then
    raise exception 'known verifier has unexpected keys: %', v_credential_keys;
  end if;

  if (v_credential ->> 'principalId')::uuid <> v_principal_id
    or v_credential ->> 'username' <> v_username
    or v_credential ->> 'algorithm' <> 'pbkdf2-hmac-sha256'
    or (v_credential ->> 'iterations')::integer <> 600000
    or (v_credential ->> 'credentialVersion')::bigint <> 1
    or v_credential ->> 'saltHex' <> pg_catalog.encode(v_salt_1, 'hex')
    or v_credential ->> 'hashHex' <> pg_catalog.encode(v_hash_1, 'hex')
  then
    raise exception 'known verifier response does not match the stored credential: %', v_credential;
  end if;

  v_unknown_result := public.begin_local_admin_login(
    pg_catalog.sha256(pg_catalog.convert_to(v_username || ':unknown-account', 'UTF8')),
    pg_catalog.sha256(pg_catalog.convert_to(v_username || ':unknown-network', 'UTF8')),
    v_username || '-missing'
  );
  if not coalesce((v_unknown_result ->> 'ok')::boolean, false)
    or not coalesce((v_unknown_result ->> 'allowed')::boolean, false)
    or pg_catalog.jsonb_typeof(v_unknown_result -> 'credential') <> 'object'
  then
    raise exception 'unknown administrator did not receive verifier-shaped data: %',
      v_unknown_result;
  end if;

  select pg_catalog.array_agg(key collate "C" order by key collate "C")
  into v_result_keys
  from pg_catalog.jsonb_object_keys(v_unknown_result) keys(key);
  if v_result_keys is distinct from array['allowed', 'credential', 'ok']::text[] then
    raise exception 'unknown verifier response is distinguishable by shape: %', v_result_keys;
  end if;

  v_credential := v_unknown_result -> 'credential';
  select pg_catalog.array_agg(key collate "C" order by key collate "C")
  into v_result_keys
  from pg_catalog.jsonb_object_keys(v_credential) keys(key);
  if v_result_keys is distinct from v_credential_keys
    or (v_credential ->> 'principalId')::uuid
      <> '00000000-0000-4000-8000-000000000000'::uuid
    or v_credential ->> 'username' <> v_username || '-missing'
    or v_credential ->> 'algorithm' <> 'pbkdf2-hmac-sha256'
    or (v_credential ->> 'iterations')::integer <> 600000
    or (v_credential ->> 'credentialVersion')::bigint <> 1
    or v_credential ->> 'saltHex' <> pg_catalog.repeat('00', 16)
    or v_credential ->> 'hashHex' <> pg_catalog.repeat('00', 32)
  then
    raise exception 'unknown verifier sentinel is unsafe or distinguishable: %', v_credential;
  end if;

  if exists (
    select 1
    from public.admin_user administrator
    where administrator.user_id = (v_username || '-missing') collate "C"
  ) or exists (
    select 1
    from app_private.local_admin_credential credential
    where credential.username = (v_username || '-missing') collate "C"
  ) or exists (
    select 1
    from app_private.principal principal
    where principal.id = '00000000-0000-4000-8000-000000000000'::uuid
  ) then
    raise exception 'unknown verifier lookup persisted a sentinel identity';
  end if;

  v_account_limit_fingerprint := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':account-limit', 'UTF8')
  );
  for attempt in 1..5 loop
    v_result := public.begin_local_admin_login(
      v_account_limit_fingerprint,
      pg_catalog.sha256(pg_catalog.convert_to(v_username || ':account-limit-network', 'UTF8')),
      v_username || '-account-limit'
    );
    if not coalesce((v_result ->> 'allowed')::boolean, false) then
      raise exception 'account throttle blocked attempt % before the five-attempt limit: %',
        attempt, v_result;
    end if;
  end loop;
  v_result := public.begin_local_admin_login(
    v_account_limit_fingerprint,
    pg_catalog.sha256(pg_catalog.convert_to(v_username || ':account-limit-network', 'UTF8')),
    v_username || '-account-limit'
  );
  if coalesce((v_result ->> 'allowed')::boolean, true)
    or not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'retryAfterSeconds')::integer not between 1 and 900
  then
    raise exception 'account throttle did not block attempt six: %', v_result;
  end if;
  if not exists (
    select 1
    from app_private.login_throttle throttle
    where throttle.scope = 'account'
      and throttle.fingerprint = v_account_limit_fingerprint
      and throttle.attempt_count = 6
      and throttle.blocked_until > pg_catalog.clock_timestamp()
  ) then
    raise exception 'account throttle did not persist its five-attempt boundary';
  end if;

  v_network_limit_fingerprint := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':network-limit', 'UTF8')
  );
  for attempt in 1..30 loop
    v_result := public.begin_local_admin_login(
      pg_catalog.sha256(
        pg_catalog.convert_to(v_username || ':network-account:' || attempt, 'UTF8')
      ),
      v_network_limit_fingerprint,
      v_username || '-network-limit'
    );
    if not coalesce((v_result ->> 'allowed')::boolean, false) then
      raise exception 'network throttle blocked attempt % before the thirty-attempt limit: %',
        attempt, v_result;
    end if;
  end loop;
  v_result := public.begin_local_admin_login(
    pg_catalog.sha256(
      pg_catalog.convert_to(v_username || ':network-account:31', 'UTF8')
    ),
    v_network_limit_fingerprint,
    v_username || '-network-limit'
  );
  if coalesce((v_result ->> 'allowed')::boolean, true)
    or not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'retryAfterSeconds')::integer not between 1 and 900
  then
    raise exception 'network throttle did not block attempt thirty-one: %', v_result;
  end if;
  if not exists (
    select 1
    from app_private.login_throttle throttle
    where throttle.scope = 'network'
      and throttle.fingerprint = v_network_limit_fingerprint
      and throttle.attempt_count = 31
      and throttle.blocked_until > pg_catalog.clock_timestamp()
  ) then
    raise exception 'network throttle did not persist its thirty-attempt boundary';
  end if;

  for attempt in 32..40 loop
    v_result := public.begin_local_admin_login(
      pg_catalog.sha256(
        pg_catalog.convert_to(v_username || ':network-account:' || attempt, 'UTF8')
      ),
      v_network_limit_fingerprint,
      v_username || '-network-spray-' || attempt
    );
    if coalesce((v_result ->> 'allowed')::boolean, true) then
      raise exception 'blocked network admitted sprayed username attempt %: %',
        attempt, v_result;
    end if;
  end loop;
  if (
    select count(*)
    from app_private.login_throttle throttle
    where throttle.scope = 'account'
      and throttle.fingerprint = any(array(
        select pg_catalog.sha256(
          pg_catalog.convert_to(v_username || ':network-account:' || attempt, 'UTF8')
        )
        from pg_catalog.generate_series(1, 40) attempt
      ))
  ) <> 30 then
    raise exception 'network-blocked username spray created account throttle rows';
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':wrong-version-token', 'UTF8')
  );
  v_result := public.create_local_admin_session(
    v_principal_id,
    2,
    v_token_hash,
    v_account_fingerprint,
    v_session_request_1
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'incorrect credential version was admitted: %', v_result;
  end if;
  if exists (
    select 1
    from app_private.app_session_token token
    where token.token_hash = v_token_hash
  ) then
    raise exception 'incorrect credential version persisted a session token';
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':session-token:1', 'UTF8')
  );
  v_result := public.create_local_admin_session(
    v_principal_id,
    1,
    v_token_hash,
    v_account_fingerprint,
    pg_catalog.gen_random_uuid()
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'username' <> v_username
    or (v_result ->> 'principalId')::uuid <> v_principal_id
  then
    raise exception 'correct credential version was not admitted: %', v_result;
  end if;
  v_session_id_1 := (v_result ->> 'sessionId')::uuid;

  v_result := public.create_local_admin_session(
    v_principal_id,
    1,
    v_token_hash,
    v_account_fingerprint,
    v_session_request_1
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or (v_result ->> 'sessionId')::uuid <> v_session_id_1
    or (
      select count(*)
      from app_private.app_session session_row
      where session_row.principal_id = v_principal_id
    ) <> 1
    or (
      select count(*)
      from app_private.app_session_token token
      where token.token_hash = v_token_hash
    ) <> 1
    or (
      select count(*)
      from app_private.audit_event audit
      where audit.action = 'session.created'
        and audit.entity_id = v_session_id_1::text
    ) <> 1
  then
    raise exception 'same-token admission retry was not idempotent: %', v_result;
  end if;

  if exists (
    select 1
    from app_private.login_throttle throttle
    where throttle.scope = 'account'
      and throttle.fingerprint = v_account_fingerprint
  ) then
    raise exception 'successful admission did not clear the account throttle';
  end if;

  for family in 2..5 loop
    v_token_hash := pg_catalog.sha256(
      pg_catalog.convert_to(v_username || ':session-token:' || family, 'UTF8')
    );
    v_result := public.create_local_admin_session(
      v_principal_id,
      1,
      v_token_hash,
      v_account_fingerprint,
      pg_catalog.gen_random_uuid()
    );
    if not coalesce((v_result ->> 'ok')::boolean, false) then
      raise exception 'session family % was rejected before the five-family cap: %',
        family, v_result;
    end if;
    if family = 2 then
      v_session_id_2 := (v_result ->> 'sessionId')::uuid;
    end if;
  end loop;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':session-token:6', 'UTF8')
  );
  v_result := public.create_local_admin_session(
    v_principal_id,
    1,
    v_token_hash,
    v_account_fingerprint,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'sixth live session family bypassed the cap: %', v_result;
  end if;
  if (
    select count(*)
    from app_private.app_session session_row
    where session_row.principal_id = v_principal_id
      and session_row.revoked_at is null
      and session_row.idle_expires_at > pg_catalog.clock_timestamp()
      and session_row.absolute_expires_at > pg_catalog.clock_timestamp()
  ) <> 5 then
    raise exception 'the live session family count is not exactly five';
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':session-token:1', 'UTF8')
  );
  select session_row.last_seen_at,
         session_row.idle_expires_at,
         session_row.absolute_expires_at
  into v_last_seen_before, v_idle_before, v_absolute_before
  from app_private.app_session session_row
  where session_row.id = v_session_id_1;
  perform pg_catalog.pg_sleep(0.01);
  v_result := public.use_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  select session_row.last_seen_at,
         session_row.idle_expires_at,
         session_row.absolute_expires_at
  into v_last_seen_after, v_idle_after, v_absolute_after
  from app_private.app_session session_row
  where session_row.id = v_session_id_1;
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'username' <> v_username
    or (v_result ->> 'principalId')::uuid <> v_principal_id
    or (v_result ->> 'sessionId')::uuid <> v_session_id_1
    or v_last_seen_after <= v_last_seen_before
    or v_idle_after <= v_idle_before
    or v_absolute_after <> v_absolute_before
    or (v_result ->> 'idleExpiresAt')::timestamptz <> v_idle_after
    or (v_result ->> 'absoluteExpiresAt')::timestamptz <> v_absolute_after
  then
    raise exception 'session use did not perform an exact idle-expiry touch: %', v_result;
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':session-token:2', 'UTF8')
  );
  v_result := public.end_local_admin_session(v_token_hash, v_logout_request);
  if v_result is distinct from '{"ok":true,"revoked":true}'::jsonb then
    raise exception 'first logout did not revoke the session family: %', v_result;
  end if;
  v_result := public.end_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":true,"revoked":false}'::jsonb then
    raise exception 'repeated logout was not idempotent: %', v_result;
  end if;
  if not exists (
    select 1
    from app_private.app_session session_row
    where session_row.id = v_session_id_2
      and session_row.revoked_at is not null
      and session_row.revoke_reason = 'logout'
  ) or (
    select count(*)
    from app_private.audit_event audit
    where audit.request_id = v_logout_request
      and audit.action = 'session.revoked'
      and audit.entity_id = v_session_id_2::text
      and audit.metadata = '{"reason":"logout"}'::jsonb
  ) <> 1 then
    raise exception 'idempotent logout did not preserve its row and audit contract';
  end if;
  v_result := public.use_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'a logged-out session remained usable: %', v_result;
  end if;

  perform pg_catalog.pg_sleep(0.01);
  v_result := app_private.set_local_admin_credential(
    v_username,
    'pbkdf2-hmac-sha256',
    600000,
    v_salt_2,
    v_hash_2,
    v_rotate_request
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or coalesce((v_result ->> 'credentialCreated')::boolean, true)
    or coalesce((v_result ->> 'principalCreated')::boolean, true)
    or (v_result ->> 'principalId')::uuid <> v_principal_id
  then
    raise exception 'credential rotation returned an invalid response: %', v_result;
  end if;

  if not exists (
    select 1
    from app_private.local_admin_credential credential
    where credential.principal_id = v_principal_id
      and credential.username = v_username
      and credential.password_algorithm = 'pbkdf2-hmac-sha256'
      and credential.password_iterations = 600000
      and credential.password_salt = v_salt_2
      and credential.password_hash = v_hash_2
      and credential.credential_version = 2
      and credential.created_at = v_created_at
      and credential.updated_at > v_first_updated_at
  ) then
    raise exception 'credential rotation did not atomically advance the verifier version';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.request_id = v_rotate_request
      and audit.action = 'credential.changed'
      and audit.entity_type = 'credential'
      and audit.entity_id = v_principal_id::text
      and audit.metadata = pg_catalog.jsonb_build_object(
        'created', false,
        'algorithm', 'pbkdf2-hmac-sha256',
        'iterations', 600000
      )
  ) <> 1 then
    raise exception 'credential rotation did not write its version-change audit event';
  end if;
  if (
    select count(*)
    from app_private.audit_event audit
    where audit.request_id = v_rotate_request
      and audit.action = 'session.revoked'
      and audit.entity_type = 'session'
      and audit.metadata = '{"reason":"security_event"}'::jsonb
  ) <> 4 then
    raise exception 'credential rotation did not audit all four live-family revocations';
  end if;
  if (
    select count(*)
    from app_private.app_session session_row
    where session_row.principal_id = v_principal_id
      and session_row.revoked_at is not null
      and session_row.revoke_reason = 'security_event'
  ) <> 4 or (
    select count(*)
    from app_private.app_session session_row
    where session_row.principal_id = v_principal_id
      and session_row.revoked_at is not null
      and session_row.revoke_reason = 'logout'
  ) <> 1 then
    raise exception 'credential rotation did not revoke every prior session exactly once';
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':session-token:1', 'UTF8')
  );
  v_result := public.use_local_admin_session(
    v_token_hash,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb then
    raise exception 'credential rotation left an old session usable: %', v_result;
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':stale-version-token', 'UTF8')
  );
  v_result := public.create_local_admin_session(
    v_principal_id,
    1,
    v_token_hash,
    v_account_fingerprint,
    pg_catalog.gen_random_uuid()
  );
  if v_result is distinct from '{"ok":false}'::jsonb
    or exists (
      select 1
      from app_private.app_session_token token
      where token.token_hash = v_token_hash
    )
  then
    raise exception 'stale credential version was admitted after rotation: %', v_result;
  end if;

  v_token_hash := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':rotated-version-token', 'UTF8')
  );
  v_result := public.create_local_admin_session(
    v_principal_id,
    2,
    v_token_hash,
    v_account_fingerprint,
    pg_catalog.gen_random_uuid()
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or v_result ->> 'username' <> v_username
    or (v_result ->> 'principalId')::uuid <> v_principal_id
  then
    raise exception 'rotated credential version was not admitted: %', v_result;
  end if;
  v_cleanup_session_id := (v_result ->> 'sessionId')::uuid;

  v_cleanup_now := pg_catalog.clock_timestamp();
  update app_private.app_session
  set created_at = v_cleanup_now - interval '40 hours',
      last_seen_at = v_cleanup_now - interval '39 hours',
      idle_expires_at = v_cleanup_now - interval '38 hours 30 minutes',
      absolute_expires_at = v_cleanup_now - interval '32 hours',
      rotate_after = v_cleanup_now - interval '39 hours 45 minutes'
  where id = v_cleanup_session_id;

  v_cleanup_throttle_fingerprint := pg_catalog.sha256(
    pg_catalog.convert_to(v_username || ':stale-cleanup-throttle', 'UTF8')
  );
  insert into app_private.login_throttle (
    scope,
    fingerprint,
    window_started_at,
    attempt_count,
    blocked_until,
    updated_at
  ) values (
    'account',
    v_cleanup_throttle_fingerprint,
    v_cleanup_now - interval '26 hours',
    1,
    null,
    v_cleanup_now - interval '25 hours'
  );

  v_result := public.begin_local_admin_login(
    pg_catalog.sha256(pg_catalog.convert_to(v_username || ':rotated-account', 'UTF8')),
    pg_catalog.sha256(pg_catalog.convert_to(v_username || ':rotated-network', 'UTF8')),
    v_username
  );
  v_credential := v_result -> 'credential';
  if not coalesce((v_result ->> 'allowed')::boolean, false)
    or (v_credential ->> 'credentialVersion')::bigint <> 2
    or v_credential ->> 'saltHex' <> pg_catalog.encode(v_salt_2, 'hex')
    or v_credential ->> 'hashHex' <> pg_catalog.encode(v_hash_2, 'hex')
  then
    raise exception 'rotated verifier was not visible to a new login: %', v_result;
  end if;
  if exists (
    select 1
    from app_private.app_session session_row
    where session_row.id = v_cleanup_session_id
  ) or exists (
    select 1
    from app_private.app_session_token token
    where token.session_id = v_cleanup_session_id
  ) or exists (
    select 1
    from app_private.login_throttle throttle
    where throttle.scope = 'account'
      and throttle.fingerprint = v_cleanup_throttle_fingerprint
  ) or (
    select count(*)
    from app_private.audit_event audit
    where audit.action = 'session.expired'
      and audit.entity_id = v_cleanup_session_id::text
  ) <> 1 then
    raise exception 'opportunistic authentication cleanup did not drain stale state';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.entity_id = v_principal_id::text
      and audit.action = 'principal.created'
  ) <> 1 or (
    select count(*)
    from app_private.audit_event audit
    where audit.entity_id = v_principal_id::text
      and audit.action = 'credential.changed'
  ) <> 2 then
    raise exception 'credential lifecycle produced an unexpected audit cardinality';
  end if;

  if exists (
    select 1
    from app_private.audit_event audit
    where audit.entity_id = v_principal_id::text
      and (
        audit.metadata::text like '%' || pg_catalog.encode(v_salt_1, 'hex') || '%'
        or audit.metadata::text like '%' || pg_catalog.encode(v_salt_2, 'hex') || '%'
        or audit.metadata::text like '%' || pg_catalog.encode(v_hash_1, 'hex') || '%'
        or audit.metadata::text like '%' || pg_catalog.encode(v_hash_2, 'hex') || '%'
      )
  ) then
    raise exception 'credential audit metadata exposed verifier material';
  end if;
end
$behavior$;

rollback;

\echo 'Local administrator authentication tests passed'
