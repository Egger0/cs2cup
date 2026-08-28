\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_role         pg_roles%rowtype;
  v_request_role text;
begin
  select * into v_role from pg_roles where rolname = 'club_admin';

  if not found then
    raise exception 'club_admin must exist in the local PostgreSQL stack';
  end if;

  if v_role.rolsuper
    or v_role.rolcreaterole
    or v_role.rolcreatedb
    or v_role.rolcanlogin
    or v_role.rolbypassrls
  then
    raise exception 'club_admin has an unsafe role attribute';
  end if;

  if has_schema_privilege('club_admin', 'public', 'create')
    or has_schema_privilege('anon', 'public', 'create')
    or has_schema_privilege('authenticated', 'public', 'create')
  then
    raise exception 'a request role can create objects in the public schema';
  end if;

  if exists (
    select 1
    from (values
      ('anon'),
      ('authenticated'),
      ('club_admin'),
      ('service_role')
    ) request_role(rolname)
    join pg_catalog.pg_roles database_role
      on database_role.rolname = request_role.rolname
    where (
        has_schema_privilege(database_role.rolname, 'app_private', 'usage')
        or exists (
          select 1
          from pg_catalog.pg_proc procedure
          join pg_catalog.pg_namespace namespace
            on namespace.oid = procedure.pronamespace
          where namespace.nspname = 'app_private'
            and has_function_privilege(
              database_role.rolname,
              procedure.oid,
              'execute'
            )
        )
      )
  ) then
    raise exception 'a request identity can access the private RPC implementation';
  end if;

  -- Every table introduced by the identity foundation is private. Check the
  -- delta from the pre-018 public schema rather than coupling this boundary to
  -- one particular table-name spelling.
  if exists (
    select 1
    from (values
      ('anon'),
      ('authenticated'),
      ('club_admin'),
      ('service_role')
    ) request_role(rolname)
    join pg_catalog.pg_roles database_role
      on database_role.rolname = request_role.rolname
    cross join pg_catalog.pg_class private_table
    join pg_catalog.pg_namespace namespace
      on namespace.oid = private_table.relnamespace
    where private_table.relkind in ('r', 'p')
      and (
        namespace.nspname = 'app_private'
        or (
          namespace.nspname = 'public'
          and private_table.relname not in (
            'site_setting',
            'game',
            'tournament',
            'team',
            'player',
            'match',
            'photo',
            'admin_user',
            'match_map',
            'club_member',
            'post',
            'registration_attempt',
            'schema_migration'
          )
        )
      )
      and (
        has_table_privilege(database_role.rolname, private_table.oid, 'select')
        or has_table_privilege(database_role.rolname, private_table.oid, 'insert')
        or has_table_privilege(database_role.rolname, private_table.oid, 'update')
        or has_table_privilege(database_role.rolname, private_table.oid, 'delete')
        or has_table_privilege(database_role.rolname, private_table.oid, 'truncate')
        or has_table_privilege(database_role.rolname, private_table.oid, 'references')
        or has_table_privilege(database_role.rolname, private_table.oid, 'trigger')
        or has_any_column_privilege(database_role.rolname, private_table.oid, 'select')
        or has_any_column_privilege(database_role.rolname, private_table.oid, 'insert')
        or has_any_column_privilege(database_role.rolname, private_table.oid, 'update')
        or has_any_column_privilege(database_role.rolname, private_table.oid, 'references')
      )
  ) then
    raise exception 'a request identity has direct access to an identity table';
  end if;

  if to_regprocedure('public.create_app_session(uuid,bytea,uuid)') is null
    or to_regprocedure('public.use_app_session(bytea,bytea,uuid)') is null
    or to_regprocedure('public.logout_app_session(bytea,uuid)') is null
    or to_regprocedure('public.revoke_app_session(uuid,uuid,text,uuid)') is null
    or to_regprocedure(
      'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'
    ) is null
    or to_regprocedure('public.consume_login_attempt(bytea,bytea)') is null
    or to_regprocedure('public.clear_login_account_throttle(bytea)') is null
    or to_regprocedure('public.cleanup_app_sessions(integer,uuid)') is null
  then
    raise exception 'the revocable-session RPC boundary is incomplete';
  end if;

  -- PostgreSQL grants EXECUTE on newly created functions to PUBLIC unless it
  -- is revoked. Inspect the effective ACL so both a null/default ACL and an
  -- explicit PUBLIC grant fail this boundary.
  if exists (
    select 1
    from unnest(array[
      'public.create_app_session(uuid,bytea,uuid)'::regprocedure,
      'public.use_app_session(bytea,bytea,uuid)'::regprocedure,
      'public.logout_app_session(bytea,uuid)'::regprocedure,
      'public.revoke_app_session(uuid,uuid,text,uuid)'::regprocedure,
      'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'::regprocedure,
      'public.consume_login_attempt(bytea,bytea)'::regprocedure,
      'public.clear_login_account_throttle(bytea)'::regprocedure,
      'public.cleanup_app_sessions(integer,uuid)'::regprocedure
    ]) expected_rpc(oid)
    join pg_catalog.pg_proc procedure on procedure.oid = expected_rpc.oid
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) function_acl
    where function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC has default or explicit EXECUTE on a session RPC';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) function_acl
    where procedure.pronamespace = 'app_private'::regnamespace
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC has default or explicit EXECUTE on a private function';
  end if;

  -- The 019 public surface is deliberately callable only by its owner and the
  -- two trusted gateway roles. Effective checks below also catch grants gained
  -- through PUBLIC or future role membership.
  if exists (
    select 1
    from unnest(array[
      'public.create_app_session(uuid,bytea,uuid)'::regprocedure,
      'public.use_app_session(bytea,bytea,uuid)'::regprocedure,
      'public.logout_app_session(bytea,uuid)'::regprocedure,
      'public.revoke_app_session(uuid,uuid,text,uuid)'::regprocedure,
      'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'::regprocedure,
      'public.consume_login_attempt(bytea,bytea)'::regprocedure,
      'public.clear_login_account_throttle(bytea)'::regprocedure,
      'public.cleanup_app_sessions(integer,uuid)'::regprocedure
    ]) expected_rpc(oid)
    join pg_catalog.pg_proc procedure on procedure.oid = expected_rpc.oid
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) function_acl
    where function_acl.privilege_type = 'EXECUTE'
      and function_acl.grantee <> procedure.proowner
      and not exists (
        select 1
        from pg_catalog.pg_roles trusted_role
        where trusted_role.oid = function_acl.grantee
          and trusted_role.rolname in ('club_admin', 'service_role')
      )
  ) then
    raise exception 'a session RPC grants EXECUTE outside its trusted allowlist';
  end if;

  foreach v_request_role in array array['anon', 'authenticated'] loop
    if has_schema_privilege(v_request_role, 'app_private', 'usage') then
      raise exception '% has USAGE on the private schema', v_request_role;
    end if;

    if exists (
      select 1
      from unnest(array[
        'public.create_app_session(uuid,bytea,uuid)'::regprocedure,
        'public.use_app_session(bytea,bytea,uuid)'::regprocedure,
        'public.logout_app_session(bytea,uuid)'::regprocedure,
        'public.revoke_app_session(uuid,uuid,text,uuid)'::regprocedure,
        'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'::regprocedure,
        'public.consume_login_attempt(bytea,bytea)'::regprocedure,
        'public.clear_login_account_throttle(bytea)'::regprocedure,
        'public.cleanup_app_sessions(integer,uuid)'::regprocedure
      ]) expected_rpc(oid)
      where has_function_privilege(v_request_role, expected_rpc.oid, 'execute')
    ) then
      raise exception '% can execute a session RPC', v_request_role;
    end if;

    if exists (
      select 1
      from unnest(array[
        'app_private.app_session'::regclass,
        'app_private.app_session_token'::regclass,
        'app_private.login_throttle'::regclass
      ]) session_table(oid)
      where has_table_privilege(v_request_role, session_table.oid, 'select')
        or has_table_privilege(v_request_role, session_table.oid, 'insert')
        or has_table_privilege(v_request_role, session_table.oid, 'update')
        or has_table_privilege(v_request_role, session_table.oid, 'delete')
        or has_table_privilege(v_request_role, session_table.oid, 'truncate')
        or has_table_privilege(v_request_role, session_table.oid, 'references')
        or has_table_privilege(v_request_role, session_table.oid, 'trigger')
        or has_any_column_privilege(v_request_role, session_table.oid, 'select')
        or has_any_column_privilege(v_request_role, session_table.oid, 'insert')
        or has_any_column_privilege(v_request_role, session_table.oid, 'update')
        or has_any_column_privilege(v_request_role, session_table.oid, 'references')
    ) then
      raise exception '% has table-level or column-level session data access',
        v_request_role;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_class private_sequence
      where private_sequence.relnamespace = 'app_private'::regnamespace
        and private_sequence.relkind = 'S'
        and (
          has_sequence_privilege(v_request_role, private_sequence.oid, 'select')
          or has_sequence_privilege(v_request_role, private_sequence.oid, 'update')
          or has_sequence_privilege(v_request_role, private_sequence.oid, 'usage')
        )
    ) then
      raise exception '% has SELECT, UPDATE, or USAGE on a private sequence',
        v_request_role;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_roles
    where rolname = 'service_role'
  ) and exists (
    select 1
    from unnest(array[
      'public.create_app_session(uuid,bytea,uuid)'::regprocedure,
      'public.use_app_session(bytea,bytea,uuid)'::regprocedure,
      'public.logout_app_session(bytea,uuid)'::regprocedure,
      'public.revoke_app_session(uuid,uuid,text,uuid)'::regprocedure,
      'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'::regprocedure,
      'public.consume_login_attempt(bytea,bytea)'::regprocedure,
      'public.clear_login_account_throttle(bytea)'::regprocedure,
      'public.cleanup_app_sessions(integer,uuid)'::regprocedure
    ]) expected_rpc(oid)
    where not has_function_privilege('service_role', expected_rpc.oid, 'execute')
  ) then
    raise exception 'service_role cannot execute every allowlisted session RPC';
  end if;

  if exists (
    select 1
    from (values
      ('app_session'),
      ('app_session_token'),
      ('login_throttle')
    ) expected_table(relname)
    left join pg_catalog.pg_class private_table
      on private_table.relname = expected_table.relname
     and private_table.relnamespace = 'app_private'::regnamespace
    where private_table.oid is null
      or not private_table.relrowsecurity
      or exists (
        select 1
        from pg_catalog.pg_policy policy
        where policy.polrelid = private_table.oid
      )
  ) then
    raise exception 'a revocable-session table lacks deny-by-default RLS';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name in ('app_session', 'app_session_token', 'login_throttle')
      and column_name ~ '(raw|cookie|provider|issuer|subject|access_token|refresh_token|claims|user_agent|ip_address)'
  ) then
    raise exception 'revocable-session schema contains credential or identity payload fields';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid =
      'app_private.app_session_token'::regclass
      and constraint_definition.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid)
        like '%octet_length(token_hash) = 32%'
  ) then
    raise exception 'session token digests are not constrained to 32 bytes';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and not (
        'search_path=pg_catalog, public' = any(coalesce(procedure.proconfig, array[]::text[]))
        or 'search_path=pg_catalog, app_private' = any(
          coalesce(procedure.proconfig, array[]::text[])
        )
      )
  ) then
    raise exception 'a public security-definer routine has an unsafe search_path';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and position('require_rpc_role' in procedure.prosrc) = 0
  ) then
    raise exception 'a public security-definer RPC lacks an in-body claims guard';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.prosecdef
  ) then
    raise exception 'a private RPC implementation still runs as security definer';
  end if;

  if has_schema_privilege('anon', 'app_private', 'usage')
    or has_schema_privilege('authenticated', 'app_private', 'usage')
    or has_schema_privilege('club_admin', 'app_private', 'usage')
  then
    raise exception 'a request role can access the private RPC schema';
  end if;

  if exists (
    select 1
    from pg_auth_members membership
    where membership.member = (select oid from pg_roles where rolname = 'club_admin')
  ) then
    raise exception 'club_admin is a member of another database role';
  end if;

  if has_table_privilege('anon', 'public.team', 'select')
    or has_table_privilege('anon', 'public.player', 'select')
    or has_table_privilege('anon', 'public.admin_user', 'select')
  then
    raise exception 'anon can select a private table';
  end if;

  if to_regprocedure('public.submit_team(jsonb)') is not null
    or to_regprocedure('public.recent_registration_attempts(text,integer)') is not null
  then
    raise exception 'a legacy registration RPC still exists after contraction';
  end if;

  if to_regprocedure('public.ensure_principal_identity(text,text,text)') is null
    or to_regprocedure('app_private.ensure_principal_identity(text,text,text)') is null
  then
    raise exception 'the principal identity RPC boundary is incomplete';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = to_regprocedure(
      'app_private.ensure_principal_identity(text,text,text)'
    )
      and procedure.prosecdef
  ) then
    raise exception 'the private principal identity implementation uses definer rights';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc procedure
    where procedure.oid = to_regprocedure(
      'public.ensure_principal_identity(text,text,text)'
    )
      and (
        not procedure.prosecdef
        or not (
          'search_path=pg_catalog, app_private' = any(
            coalesce(procedure.proconfig, array[]::text[])
          )
        )
        or position('require_rpc_role' in procedure.prosrc) = 0
        or position('app_private.ensure_principal_identity' in procedure.prosrc) = 0
      )
  ) then
    raise exception 'the public principal identity wrapper is not claims-guarded';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_public'
      and column_name in ('contact', 'note')
  ) then
    raise exception 'team_public exposes private registration fields';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class view_relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = view_relation.relnamespace
    join pg_catalog.pg_attribute column_definition
      on column_definition.attrelid = view_relation.oid
    where namespace.nspname = 'public'
      and view_relation.relkind in ('v', 'm')
      and column_definition.attnum > 0
      and not column_definition.attisdropped
      and column_definition.attname ~ '(principal|subject)'
      and (
        has_table_privilege('anon', view_relation.oid, 'select')
        or has_table_privilege('authenticated', view_relation.oid, 'select')
      )
  ) then
    raise exception 'a public view exposes a principal or identity subject';
  end if;
end
$test$;

-- The database owner is an operational identity, not an implicit gateway
-- authorization claim. Keep this regression separate from the distinct
-- authenticator simulation below so session_user = current_user can never
-- become a public-wrapper bypass again.
do $test$
declare
  v_claims text;
begin
  if session_user <> current_user then
    raise exception 'owner-claims regression must run as the database owner';
  end if;

  foreach v_claims in array array['', '{malformed-json'] loop
    perform set_config('request.jwt.claims', v_claims, true);
    begin
      perform public.set_team_seed(null, null, null);
      raise exception 'database owner reached a privileged RPC without valid claims';
    exception
      when insufficient_privilege then null;
    end;

    begin
      perform public.ensure_principal_identity(
        'cloudbase',
        'https://owner-no-claims.example',
        'owner-no-claims'
      );
      raise exception 'database owner reached principal provisioning without valid claims';
    exception
      when insufficient_privilege then null;
    end;

    begin
      perform public.cleanup_app_sessions(
        1,
        '00000000-0000-4000-8000-000000000001'
      );
      raise exception 'database owner reached session cleanup without valid claims';
    exception
      when insufficient_privilege then null;
    end;
  end loop;
end
$test$;

-- CloudBase currently exposes public RPC endpoints even when PostgreSQL
-- EXECUTE was revoked. Grant endpoint reachability deliberately and prove the
-- in-body JWT-claims guard still rejects anon/authenticated callers.
grant usage on schema public to anon_authenticator;
grant execute on all functions in schema public to anon_authenticator;
set session authorization anon_authenticator;

do $test$
declare
  v_claims text;
  v_request_role text;
  v_statement text;
  v_statements text[] := array[
    $sql$select public.submit_team_rate_limited(
      'v1:' || repeat('f', 64),
      jsonb_build_object('slug', 'claims-denied')
    )$sql$,
    $sql$select public.set_team_seed(null, null, null)$sql$,
    $sql$select public.replace_bracket(null, array[]::bigint[], array[]::integer[])$sql$,
    $sql$select public.save_match_score(null, null, null, null, null)$sql$,
    $sql$select public.save_match_report(null, null, null, '[]'::jsonb)$sql$,
    $sql$select public.replace_match_schedule(
      null,
      array[]::bigint[],
      array[]::timestamptz[],
      array[]::timestamptz[]
    )$sql$,
    $sql$select public.ensure_principal_identity(
      'cloudbase',
      'https://claims-denied.example',
      'claims-denied'
    )$sql$,
    $sql$select public.create_app_session(
      null::uuid,
      decode(repeat('1', 64), 'hex'),
      '00000000-0000-4000-8000-000000000011'
    )$sql$,
    $sql$select public.use_app_session(
      decode(repeat('2', 64), 'hex'),
      decode(repeat('3', 64), 'hex'),
      '00000000-0000-4000-8000-000000000012'
    )$sql$,
    $sql$select public.logout_app_session(
      decode(repeat('4', 64), 'hex'),
      '00000000-0000-4000-8000-000000000013'
    )$sql$,
    $sql$select public.revoke_app_session(
      '00000000-0000-4000-8000-000000000014',
      null::uuid,
      'security_event',
      '00000000-0000-4000-8000-000000000015'
    )$sql$,
    $sql$select public.revoke_principal_sessions(
      '00000000-0000-4000-8000-000000000016',
      null::uuid,
      null::uuid,
      'security_event',
      '00000000-0000-4000-8000-000000000017'
    )$sql$,
    $sql$select public.consume_login_attempt(
      decode(repeat('5', 64), 'hex'),
      decode(repeat('6', 64), 'hex')
    )$sql$,
    $sql$select public.clear_login_account_throttle(
      decode(repeat('7', 64), 'hex')
    )$sql$,
    $sql$select public.cleanup_app_sessions(
      1,
      '00000000-0000-4000-8000-000000000018'
    )$sql$
  ];
begin
  foreach v_claims in array array[
    '',
    '{malformed-json',
    '{}',
    '{"role":"club_admin"}',
    '{"role":"service-role"}'
  ] loop
    perform set_config('request.jwt.claims', v_claims, true);
    begin
      perform public.ensure_principal_identity(
        'cloudbase',
        'https://forged-claims.example',
        'forged-claims'
      );
      raise exception 'invalid claims reached principal provisioning: %', v_claims;
    exception
      when insufficient_privilege then null;
    end;
  end loop;

  foreach v_request_role in array array['anon', 'authenticated'] loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('role', v_request_role)::text,
      true
    );
    perform public.registration_status('claims-public-probe');

    foreach v_statement in array v_statements loop
      begin
        execute v_statement;
        raise exception '% claims reached privileged RPC: %', v_request_role, v_statement;
      exception
        when insufficient_privilege then null;
      end;
    end loop;
  end loop;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  if public.submit_team_rate_limited(
    'v1:' || repeat('e', 64),
    jsonb_build_object('slug', 'claims-service-probe')
  ) ->> 'error' is distinct from '当前赛事不存在或不可报名' then
    raise exception 'service_role claims did not reach the guarded registration RPC';
  end if;

  perform public.ensure_principal_identity(
    'cloudbase',
    'https://claims-service.example',
    'claims-service'
  );

  foreach v_statement in array v_statements[2:array_length(v_statements, 1)] loop
    begin
      execute v_statement;
    exception
      when insufficient_privilege then
        raise exception 'service_role claims were rejected by privileged RPC: %', v_statement;
      when others then null;
    end;
  end loop;
end
$test$;

reset session authorization;
set local request.jwt.claims = '{"role":"service_role"}';

do $test$
declare
  v_anon_auth  pg_roles%rowtype;
  v_admin_auth pg_roles%rowtype;
begin
  select * into v_anon_auth from pg_roles where rolname = 'anon_authenticator';
  select * into v_admin_auth from pg_roles where rolname = 'admin_authenticator';

  if v_anon_auth.rolname is null or v_admin_auth.rolname is null then
    raise exception 'dedicated PostgREST authenticators are missing';
  end if;

  if not v_anon_auth.rolcanlogin
    or v_anon_auth.rolsuper
    or v_anon_auth.rolinherit
    or v_anon_auth.rolcreaterole
    or v_anon_auth.rolcreatedb
    or v_anon_auth.rolbypassrls
  then
    raise exception 'anon_authenticator has unsafe role attributes';
  end if;

  if not v_admin_auth.rolcanlogin
    or v_admin_auth.rolsuper
    or v_admin_auth.rolinherit
    or v_admin_auth.rolcreaterole
    or v_admin_auth.rolcreatedb
    or v_admin_auth.rolbypassrls
  then
    raise exception 'admin_authenticator has unsafe role attributes';
  end if;

  if not pg_has_role('anon_authenticator', 'anon', 'set')
    or pg_has_role('anon_authenticator', 'club_admin', 'set')
    or not pg_has_role('admin_authenticator', 'club_admin', 'set')
    or pg_has_role('admin_authenticator', 'anon', 'set')
  then
    raise exception 'PostgREST authenticator memberships are not least privilege';
  end if;
end
$test$;

insert into public.game (slug, name, active)
values ('security-boundaries-game', 'Security boundary test', true)
returning id as boundary_game_id \gset

insert into public.tournament (
  slug, title, game_id, season, edition, status, team_cap
)
values (
  'security-boundaries-draft', 'Draft boundary test', :'boundary_game_id',
  'test', 9001, 'draft', 8
)
returning id as draft_tournament_id \gset

insert into public.tournament (
  slug, title, game_id, season, edition, status, team_cap
)
values (
  'security-boundaries-public', 'Public boundary test', :'boundary_game_id',
  'test', 9002, 'registration', 8
)
returning id as public_tournament_id \gset

insert into public.team (
  tournament_id, name, tag, captain, contact, note, status
)
values (
  :'draft_tournament_id', 'Draft Team', 'SBD', 'Draft Captain',
  'private-draft-contact', 'private draft note', 'approved'
)
returning id as draft_team_id \gset

insert into public.team (
  tournament_id, name, tag, captain, contact, note, status
)
values (
  :'public_tournament_id', 'Public Team', 'SBP', 'Public Captain',
  'private-public-contact', 'private public note', 'approved'
)
returning id as public_team_id \gset

insert into public.player (team_id, nickname, sort_order)
values (:'draft_team_id', 'Draft Player', 1);

insert into public.player (team_id, nickname, sort_order)
values (:'public_team_id', 'Public Player', 1);

insert into public.match (
  tournament_id, round, slot, round_label, team_a_id
)
values (:'draft_tournament_id', 1, 1, 'Draft round', :'draft_team_id')
returning id as draft_match_id \gset

insert into public.match (
  tournament_id, round, slot, round_label, team_a_id
)
values (:'public_tournament_id', 1, 1, 'Public round', :'public_team_id')
returning id as public_match_id \gset

insert into public.match_map (match_id, pick_order, map_name, action)
values (:'draft_match_id', 1, 'de_draft', 'decider');

insert into public.match_map (match_id, pick_order, map_name, action)
values (:'public_match_id', 1, 'de_public', 'decider');

insert into public.photo (tournament_id, storage_key, width, height, caption)
values (:'draft_tournament_id', 'security-boundaries/draft.webp', 1, 1, 'Draft photo');

insert into public.photo (tournament_id, storage_key, width, height, caption)
values (:'public_tournament_id', 'security-boundaries/public.webp', 1, 1, 'Public photo');

insert into public.post (slug, title, summary, body, published_at)
values (
  'security-boundaries-past', 'Published post', 'Published', 'Published',
  now() - interval '1 hour'
);

insert into public.post (slug, title, summary, body, published_at)
values (
  'security-boundaries-future', 'Future post', 'Future', 'Future',
  now() + interval '1 day'
);

set local role anon;

do $test$
begin
  if (select count(*) from public.tournament where slug like 'security-boundaries-%') <> 1 then
    raise exception 'anon tournament RLS exposed a draft tournament';
  end if;

  if exists (select 1 from public.team_public where tag = 'SBD')
    or not exists (select 1 from public.team_public where tag = 'SBP')
  then
    raise exception 'team_public did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.player_public where nickname = 'Draft Player')
    or not exists (select 1 from public.player_public where nickname = 'Public Player')
  then
    raise exception 'player_public did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.match where round_label = 'Draft round')
    or not exists (select 1 from public.match where round_label = 'Public round')
  then
    raise exception 'match RLS did not enforce the tournament boundary';
  end if;

  if exists (select 1 from public.match_map where map_name = 'de_draft')
    or not exists (select 1 from public.match_map where map_name = 'de_public')
    or exists (select 1 from public.match_map_public where map_name = 'de_draft')
    or not exists (select 1 from public.match_map_public where map_name = 'de_public')
  then
    raise exception 'match-map boundaries exposed draft data';
  end if;

  if exists (
    select 1 from public.photo where storage_key = 'security-boundaries/draft.webp'
  ) or not exists (
    select 1 from public.photo where storage_key = 'security-boundaries/public.webp'
  ) or exists (
    select 1 from public.photo_public where storage_key = 'security-boundaries/draft.webp'
  ) or not exists (
    select 1 from public.photo_public where storage_key = 'security-boundaries/public.webp'
  ) then
    raise exception 'photo boundaries exposed a draft object key';
  end if;

  if exists (select 1 from public.post where slug = 'security-boundaries-future')
    or not exists (select 1 from public.post where slug = 'security-boundaries-past')
  then
    raise exception 'post RLS exposed unpublished content';
  end if;

  if public.registration_status('security-boundaries-draft') is not null then
    raise exception 'registration_status exposed a draft tournament';
  end if;

  if (public.registration_status('security-boundaries-public') ->> 'cap')::integer <> 8 then
    raise exception 'registration_status hid a published tournament';
  end if;
end
$test$;

reset role;
set local role authenticated;

do $test$
begin
  if exists (select 1 from public.team_public where tag = 'SBD')
    or exists (select 1 from public.photo_public where storage_key like '%/draft.webp')
    or exists (select 1 from public.post where slug = 'security-boundaries-future')
  then
    raise exception 'authenticated public reads exposed unpublished data';
  end if;
end
$test$;

reset role;
set local role club_admin;

do $test$
begin
  if not exists (select 1 from public.tournament where slug = 'security-boundaries-draft')
    or not exists (select 1 from public.photo where storage_key = 'security-boundaries/draft.webp')
    or not exists (select 1 from public.post where slug = 'security-boundaries-future')
  then
    raise exception 'club_admin cannot review unpublished content';
  end if;

  if has_table_privilege('club_admin', 'public.registration_attempt', 'insert') then
    raise exception 'club_admin can bypass the guarded registration function';
  end if;

  if to_regprocedure('public.submit_team(jsonb)') is not null
    or not has_function_privilege(
      'club_admin',
      'public.submit_team_rate_limited(text,jsonb)',
      'execute'
    )
  then
    raise exception 'club_admin registration function privileges are unsafe';
  end if;
end
$test$;

reset role;
rollback;

\echo 'security boundary regression tests passed'
