\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_table text;
begin
  foreach v_table in array array[
    'principal',
    'principal_identity',
    'principal_profile',
    'role_assignment',
    'team_ownership',
    'audit_event'
  ] loop
    if to_regclass('app_private.' || v_table) is null then
      raise exception 'identity foundation table is missing: %', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_private'
        and relation.relname = v_table
        and relation.relrowsecurity
    ) then
      raise exception 'identity foundation table does not enable RLS: %', v_table;
    end if;

    if exists (
      select 1
      from pg_catalog.pg_policies policy
      where policy.schemaname = 'app_private'
        and policy.tablename = v_table
    ) then
      raise exception 'identity foundation table unexpectedly has an RLS policy: %', v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'admin_user'
      and column_name = 'principal_id'
      and is_nullable = 'YES'
      and udt_name = 'uuid'
  ) then
    raise exception 'admin_user nullable principal bridge is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'player'
      and column_name = 'principal_id'
      and is_nullable = 'YES'
      and udt_name = 'uuid'
  ) then
    raise exception 'player nullable principal bridge is missing';
  end if;

  if exists (
    select 1 from app_private.principal
    union all select 1 from app_private.principal_identity
    union all select 1 from app_private.principal_profile
    union all select 1 from app_private.role_assignment
    union all select 1 from app_private.team_ownership
    union all select 1 from app_private.audit_event
  ) then
    raise exception 'identity migration fabricated foundation rows';
  end if;

  if exists (select 1 from public.admin_user where principal_id is not null)
    or exists (select 1 from public.player where principal_id is not null)
  then
    raise exception 'identity migration fabricated compatibility links';
  end if;

  if to_regprocedure('app_private.ensure_principal_identity(text,text,text)') is null
    or to_regprocedure('public.ensure_principal_identity(text,text,text)') is null
  then
    raise exception 'principal identity resolver contract is incomplete';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_attribute column_definition
    where column_definition.attrelid = 'app_private.principal_identity'::regclass
      and column_definition.attname in ('provider', 'issuer', 'subject')
      and not column_definition.attisdropped
      and column_definition.attcollation = 'pg_catalog."C"'::regcollation
  ) <> 3 then
    raise exception 'identity namespace columns do not use locale-independent collation';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    where routine.oid = to_regprocedure(
      'app_private.ensure_principal_identity(text,text,text)'
    )
      and routine.prosecdef
  ) then
    raise exception 'private identity resolver must use invoker rights';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    where routine.oid = to_regprocedure(
      'public.ensure_principal_identity(text,text,text)'
    )
      and routine.prosecdef
      and routine.prosrc like '%app_private.require_rpc_role%'
      and routine.prosrc like '%app_private.ensure_principal_identity%'
      and 'search_path=pg_catalog, app_private' = any(
        coalesce(routine.proconfig, array[]::text[])
      )
  ) then
    raise exception 'public identity resolver is missing its guarded wrapper contract';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.conrelid = 'app_private.audit_event'::regclass
      and constraint_definition.confrelid = 'public.tournament'::regclass
      and constraint_definition.contype = 'f'
      and constraint_definition.confdeltype = 'r'
  ) then
    raise exception 'audit tournament relationship is not delete-restricting';
  end if;
end
$test$;

do $test$
declare
  v_role text;
  v_table text;
  v_private_function regprocedure;
  v_private_sequence regclass;
begin
  foreach v_role in array array['anon', 'authenticated', 'club_admin', 'service_role'] loop
    continue when not exists (
      select 1 from pg_catalog.pg_roles where rolname = v_role
    );

    if has_schema_privilege(v_role, 'app_private', 'usage') then
      raise exception '% can use the private identity schema', v_role;
    end if;

    foreach v_table in array array[
      'principal',
      'principal_identity',
      'principal_profile',
      'role_assignment',
      'team_ownership',
      'audit_event'
    ] loop
      if has_table_privilege(v_role, 'app_private.' || v_table, 'select')
        or has_table_privilege(v_role, 'app_private.' || v_table, 'insert')
        or has_table_privilege(v_role, 'app_private.' || v_table, 'update')
        or has_table_privilege(v_role, 'app_private.' || v_table, 'delete')
      then
        raise exception '% can access private table %', v_role, v_table;
      end if;
    end loop;

    for v_private_function in
      select routine.oid::regprocedure
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'app_private'
    loop
      if has_function_privilege(v_role, v_private_function, 'execute') then
        raise exception '% can execute private function %', v_role, v_private_function;
      end if;
    end loop;

    for v_private_sequence in
      select sequence_relation.oid::regclass
      from pg_catalog.pg_class sequence_relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = sequence_relation.relnamespace
      where namespace.nspname = 'app_private'
        and sequence_relation.relkind = 'S'
    loop
      if has_sequence_privilege(v_role, v_private_sequence, 'usage')
        or has_sequence_privilege(v_role, v_private_sequence, 'select')
        or has_sequence_privilege(v_role, v_private_sequence, 'update')
      then
        raise exception '% can access private sequence %', v_role, v_private_sequence;
      end if;
    end loop;

    if v_role in ('club_admin', 'service_role')
      and not has_function_privilege(
        v_role,
        'public.ensure_principal_identity(text,text,text)',
        'execute'
      )
    then
      raise exception '% cannot reach the guarded public identity resolver', v_role;
    end if;
  end loop;

  if has_function_privilege(
    'anon',
    'public.ensure_principal_identity(text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.ensure_principal_identity(text,text,text)',
    'execute'
  ) then
    raise exception 'a public request role can execute the trusted identity resolver';
  end if;
end
$test$;

-- PostgreSQL ownership is not a gateway authorization bypass.
do $test$
declare
  v_claims text;
begin
  foreach v_claims in array array['', '{malformed-json', '{"role":"anon"}'] loop
    perform pg_catalog.set_config('request.jwt.claims', v_claims, true);
    begin
      perform public.ensure_principal_identity(
        'cloudbase',
        'cloudbase:identity-foundations-denied',
        'denied-subject'
      );
      raise exception 'untrusted claims reached the identity resolver: %', v_claims;
    exception
      when insufficient_privilege then null;
    end;
  end loop;
end
$test$;

do $test$
declare
  v_first             jsonb;
  v_repeat            jsonb;
  v_other_issuer      jsonb;
  v_case_variant      jsonb;
  v_first_principal   uuid;
  v_other_principal   uuid;
  v_case_principal    uuid;
  v_deleted           jsonb;
  v_deleted_principal uuid;
  v_deleted_verified  timestamptz;
  v_principal_count   bigint;
  v_identity_count    bigint;
  v_audit_count       bigint;
  v_tournament_id     bigint;
  v_audit_tournament_id bigint;
  v_team_id           bigint;
  v_second_principal  uuid;
  v_third_principal   uuid;
  v_audit_id          bigint;
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );

  v_first := public.ensure_principal_identity(
    'cloudbase',
    'cloudbase:identity-foundations-a',
    'CaseSensitiveSubject'
  );
  v_repeat := public.ensure_principal_identity(
    'cloudbase',
    'cloudbase:identity-foundations-a',
    'CaseSensitiveSubject'
  );
  v_other_issuer := public.ensure_principal_identity(
    'cloudbase',
    'cloudbase:identity-foundations-b',
    'CaseSensitiveSubject'
  );
  v_case_variant := public.ensure_principal_identity(
    'cloudbase',
    'cloudbase:identity-foundations-a',
    'casesensitivesubject'
  );
  v_deleted := public.ensure_principal_identity(
    'cloudbase',
    'cloudbase:identity-foundations-deleted',
    'DeletedSubject'
  );

  v_first_principal := (v_first ->> 'principalId')::uuid;
  v_other_principal := (v_other_issuer ->> 'principalId')::uuid;
  v_case_principal := (v_case_variant ->> 'principalId')::uuid;
  v_deleted_principal := (v_deleted ->> 'principalId')::uuid;
  v_second_principal := v_other_principal;
  v_third_principal := v_case_principal;

  if not coalesce((v_first ->> 'ok')::boolean, false)
    or not coalesce((v_first ->> 'created')::boolean, false)
    or (v_repeat ->> 'created')::boolean
    or (v_repeat ->> 'principalId')::uuid <> v_first_principal
  then
    raise exception 'identity resolution is not idempotent';
  end if;

  if v_other_principal = v_first_principal then
    raise exception 'identity issuer namespace was ignored';
  end if;

  if v_case_principal = v_first_principal then
    raise exception 'opaque identity subject was case-folded';
  end if;

  select last_verified_at
  into v_deleted_verified
  from app_private.principal_identity
  where principal_id = v_deleted_principal;

  update app_private.principal
  set status = 'deleted', deleted_at = pg_catalog.clock_timestamp()
  where id = v_deleted_principal;

  select count(*) into v_principal_count from app_private.principal;
  select count(*) into v_identity_count from app_private.principal_identity;
  select count(*) into v_audit_count from app_private.audit_event;

  begin
    perform public.ensure_principal_identity(
      'cloudbase',
      'cloudbase:identity-foundations-deleted',
      'DeletedSubject'
    );
    raise exception 'deleted principal identity was silently reactivated';
  exception
    when sqlstate '55000' then null;
  end;

  if (select count(*) from app_private.principal) <> v_principal_count
    or (select count(*) from app_private.principal_identity) <> v_identity_count
    or (select count(*) from app_private.audit_event) <> v_audit_count
    or (
      select last_verified_at
      from app_private.principal_identity
      where principal_id = v_deleted_principal
    ) is distinct from v_deleted_verified
  then
    raise exception 'deleted identity rejection changed identity or audit state';
  end if;

  if (
    select count(*)
    from app_private.principal_identity
    where provider = 'cloudbase'
      and issuer = 'cloudbase:identity-foundations-a'
      and subject = 'CaseSensitiveSubject'
  ) <> 1 then
    raise exception 'identity resolver created duplicate bindings';
  end if;

  select audit.id
  into v_audit_id
  from app_private.audit_event audit
  where audit.action = 'principal.created'
    and audit.entity_type = 'principal'
    and audit.entity_id = v_first_principal::text;

  if not found then
    raise exception 'identity creation did not append an audit event';
  end if;

  if (
    select count(*)
    from app_private.audit_event audit
    where audit.action = 'principal.created'
      and audit.entity_id = v_first_principal::text
  ) <> 1 then
    raise exception 'idempotent identity resolution duplicated its creation audit';
  end if;

  if exists (
    select 1
    from app_private.audit_event audit
    where audit.id = v_audit_id
      and (
        audit.actor_type <> 'system'
        or audit.actor_principal_id is not null
        or audit.metadata <> '{}'::jsonb
        or audit.metadata::text like '%CaseSensitiveSubject%'
        or audit.metadata::text like '%identity-foundations-a%'
      )
  ) then
    raise exception 'principal creation audit contains identity data';
  end if;

  begin
    perform public.ensure_principal_identity('', 'issuer', 'subject');
    raise exception 'invalid provider was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.ensure_principal_identity(
      'cloudbase',
      ' issuer',
      'subject'
    );
    raise exception 'whitespace-padded issuer was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    perform public.ensure_principal_identity(
      'cloudbase',
      'issuer',
      E'subject\nvalue'
    );
    raise exception 'control character in subject was accepted';
  exception
    when invalid_parameter_value then null;
  end;

  insert into app_private.principal_profile (
    principal_id,
    display_name,
    handle
  ) values (
    v_first_principal,
    'Identity Test',
    'identity-test'
  );

  if (
    select visibility
    from app_private.principal_profile
    where principal_id = v_first_principal
  ) <> 'private' then
    raise exception 'new profile is not private by default';
  end if;

  begin
    insert into app_private.principal_profile (
      principal_id,
      display_name,
      handle
    ) values (
      v_second_principal,
      'Duplicate Handle',
      'identity-test'
    );
    raise exception 'duplicate profile handle was accepted';
  exception
    when unique_violation then null;
  end;

  begin
    insert into app_private.principal_profile (
      principal_id,
      display_name,
      handle
    ) values (
      v_second_principal,
      'Invalid Handle',
      'Invalid-Handle'
    );
    raise exception 'invalid profile handle was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.principal_profile (
      principal_id,
      display_name
    ) values (
      v_second_principal,
      ' Padded Display Name '
    );
    raise exception 'whitespace-padded display name was accepted';
  exception
    when check_violation then null;
  end;

  insert into public.tournament (
    slug,
    title,
    season,
    edition
  ) values (
    'identity-foundations-test',
    'Identity foundations test',
    'test',
    987654
  ) returning id into v_tournament_id;

  insert into public.team (
    tournament_id,
    name,
    tag,
    captain,
    contact
  ) values (
    v_tournament_id,
    'Identity Test Team',
    'IDT',
    'Captain',
    'private-contact'
  ) returning id into v_team_id;

  insert into app_private.role_assignment (principal_id, role, granted_by)
  values (v_first_principal, 'platform_admin', v_first_principal);

  insert into app_private.role_assignment (
    principal_id,
    role,
    tournament_id,
    granted_by
  ) values (
    v_second_principal,
    'registration_reviewer',
    v_tournament_id,
    v_first_principal
  );

  begin
    insert into app_private.role_assignment (
      principal_id,
      role,
      tournament_id
    ) values (
      v_third_principal,
      'content_editor',
      v_tournament_id
    );
    raise exception 'global role accepted a tournament scope';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.role_assignment (principal_id, role)
    values (v_third_principal, 'match_reporter');
    raise exception 'tournament role accepted a global scope';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.role_assignment (principal_id, role)
    values (v_first_principal, 'platform_admin');
    raise exception 'duplicate active global role was accepted';
  exception
    when unique_violation then null;
  end;

  update app_private.role_assignment
  set revoked_at = pg_catalog.clock_timestamp()
  where principal_id = v_first_principal
    and role = 'platform_admin'
    and revoked_at is null;

  insert into app_private.role_assignment (principal_id, role)
  values (v_first_principal, 'platform_admin');

  insert into app_private.team_ownership (
    team_id,
    principal_id,
    role,
    granted_by
  ) values (
    v_team_id,
    v_first_principal,
    'owner',
    v_first_principal
  );

  insert into app_private.team_ownership (
    team_id,
    principal_id,
    role,
    granted_by
  ) values (
    v_team_id,
    v_second_principal,
    'manager',
    v_first_principal
  );

  begin
    insert into app_private.team_ownership (team_id, principal_id, role)
    values (v_team_id, v_third_principal, 'owner');
    raise exception 'second active team owner was accepted';
  exception
    when unique_violation then null;
  end;

  begin
    insert into app_private.team_ownership (team_id, principal_id, role)
    values (v_team_id, v_second_principal, 'manager');
    raise exception 'duplicate active team principal was accepted';
  exception
    when unique_violation then null;
  end;

  insert into public.player (team_id, nickname, sort_order)
  values
    (v_team_id, 'Anonymous One', 1),
    (v_team_id, 'Anonymous Two', 2);

  insert into public.player (team_id, nickname, sort_order, principal_id)
  values (v_team_id, 'Linked Player', 3, v_third_principal);

  begin
    insert into public.player (team_id, nickname, sort_order, principal_id)
    values (v_team_id, 'Duplicate Link', 4, v_third_principal);
    raise exception 'duplicate team principal roster link was accepted';
  exception
    when unique_violation then null;
  end;

  insert into public.admin_user (user_id, note)
  values ('identity-foundations-unlinked-admin', 'compatibility probe');

  if (
    select principal_id
    from public.admin_user
    where user_id = 'identity-foundations-unlinked-admin'
  ) is not null then
    raise exception 'legacy admin unexpectedly received a fabricated identity';
  end if;

  if exists (
    select 1
    from app_private.team_ownership ownership
    where ownership.team_id = v_team_id
      and ownership.principal_id is null
  ) then
    raise exception 'team ownership accepted a null principal';
  end if;

  begin
    insert into app_private.audit_event (
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    ) values (
      'system',
      'test.invalid_metadata',
      'test',
      'invalid-array',
      '[]'::jsonb
    );
    raise exception 'non-object audit metadata was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.audit_event (
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    ) values (
      'system',
      'test.oversized_metadata',
      'test',
      'oversized',
      pg_catalog.jsonb_build_object('value', pg_catalog.repeat('x', 8192))
    );
    raise exception 'oversized audit metadata was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.audit_event (
      actor_type,
      action,
      entity_type,
      entity_id
    ) values (
      'principal',
      'test.invalid_actor',
      'test',
      'missing-principal'
    );
    raise exception 'principal audit actor without a principal ID was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into app_private.audit_event (
      actor_type,
      actor_principal_id,
      action,
      entity_type,
      entity_id
    ) values (
      'system',
      v_first_principal,
      'test.invalid_actor',
      'test',
      'system-with-principal'
    );
    raise exception 'system audit actor with a principal ID was accepted';
  exception
    when check_violation then null;
  end;

  begin
    update app_private.audit_event
    set metadata = '{"changed":true}'::jsonb
    where id = v_audit_id;
    raise exception 'audit event update was accepted';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    delete from app_private.audit_event where id = v_audit_id;
    raise exception 'audit event deletion was accepted';
  exception
    when sqlstate '55000' then null;
  end;

  begin
    truncate table app_private.audit_event;
    raise exception 'audit event truncation was accepted';
  exception
    when sqlstate '55000' then null;
  end;

  if not exists (
    select 1 from app_private.audit_event where id = v_audit_id
  ) then
    raise exception 'append-only audit event was removed';
  end if;

  insert into public.tournament (
    slug,
    title,
    season,
    edition
  ) values (
    'identity-foundations-audit-retention',
    'Identity audit retention test',
    'test',
    987655
  ) returning id into v_audit_tournament_id;

  insert into app_private.audit_event (
    actor_type,
    action,
    entity_type,
    entity_id,
    tournament_id
  ) values (
    'system',
    'tournament.retention_tested',
    'tournament',
    v_audit_tournament_id::text,
    v_audit_tournament_id
  );

  begin
    delete from public.tournament where id = v_audit_tournament_id;
    raise exception 'tournament with retained audit evidence was deleted';
  exception
    when foreign_key_violation then null;
  end;

  if not exists (
    select 1
    from app_private.audit_event
    where tournament_id = v_audit_tournament_id
      and action = 'tournament.retention_tested'
  ) then
    raise exception 'tournament deletion removed its audit evidence';
  end if;
end
$test$;

rollback;

select 'identity foundations tests passed' as result;
