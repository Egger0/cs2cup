-- Bind verified administrator identities to stable Principals and admit a
-- bounded application-session family in one database transaction. The legacy
-- admin allowlist remains authoritative for this bridge migration; broader
-- Principal lifecycle and role-assignment administration are intentionally
-- deferred.

set local lock_timeout = '5s';

create function app_private.admit_admin_app_session(
  p_provider text,
  p_issuer text,
  p_subject text,
  p_token_hash bytea,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, app_private
as $$
declare
  v_admin_principal_id    uuid;
  v_identity_result       jsonb;
  v_identity_principal_id uuid;
  v_principal_status      text;
  v_live_family_count     integer;
  v_now                   timestamptz;
  v_session_result        jsonb;
begin
  -- Reject malformed transport inputs before taking admission locks. These
  -- helpers emit stable diagnostics that contain no credential material.
  perform app_private.require_session_digest(p_token_hash);
  perform app_private.require_session_request_id(p_request_id);

  -- This block is an internal subtransaction. Every expected denial raises the
  -- private P2B01 condition, rolling back identity creation, verification-time
  -- updates, compatibility linking, session rows, and audit rows before the
  -- one non-enumerating response is returned by the handler.
  begin
    select admin.principal_id
    into v_admin_principal_id
    from public.admin_user admin
    where admin.user_id collate "C" = p_subject collate "C"
    for update of admin;

    if not found then
      raise exception using
        errcode = 'P2B01',
        message = 'admin session admission denied';
    end if;

    begin
      v_identity_result := app_private.ensure_principal_identity(
        p_provider,
        p_issuer,
        p_subject
      );
    exception
      when sqlstate '55000' then
        -- A tuple attached to a deleted Principal is an expected admission
        -- denial. Do not expose that lifecycle state to the caller.
        raise exception using
          errcode = 'P2B01',
          message = 'admin session admission denied';
    end;

    v_identity_principal_id := (v_identity_result ->> 'principalId')::uuid;
    if v_identity_principal_id is null then
      raise exception using
        errcode = 'P2B01',
        message = 'admin session admission denied';
    end if;

    if v_admin_principal_id is null then
      begin
        update public.admin_user
        set principal_id = v_identity_principal_id
        where user_id collate "C" = p_subject collate "C"
          and principal_id is null;

        if not found then
          raise exception using
            errcode = 'P2B01',
            message = 'admin session admission denied';
        end if;
      exception
        when unique_violation then
          -- The one-to-one compatibility bridge already belongs to another
          -- administrator row. Keep the conflict indistinguishable from every
          -- other expected admission denial.
          raise exception using
            errcode = 'P2B01',
            message = 'admin session admission denied';
      end;

      v_admin_principal_id := v_identity_principal_id;
    elsif v_admin_principal_id <> v_identity_principal_id then
      raise exception using
        errcode = 'P2B01',
        message = 'admin session admission denied';
    end if;

    -- An exclusive Principal row lock serializes the cap with every other
    -- admission using this boundary and conflicts with the shared Principal
    -- lock used by the existing 019 creation primitive. Sample status and time
    -- only after the lock is held.
    select principal.status
    into v_principal_status
    from app_private.principal principal
    where principal.id = v_identity_principal_id
    for update;

    if v_principal_status is distinct from 'active' then
      raise exception using
        errcode = 'P2B01',
        message = 'admin session admission denied';
    end if;

    v_now := pg_catalog.clock_timestamp();

    select pg_catalog.count(*)::integer
    into v_live_family_count
    from app_private.app_session session_row
    where session_row.principal_id = v_identity_principal_id
      and session_row.revoked_at is null
      and session_row.idle_expires_at > v_now
      and session_row.absolute_expires_at > v_now;

    if v_live_family_count >= 5 then
      raise exception using
        errcode = 'P2B01',
        message = 'admin session admission denied';
    end if;

    v_session_result := app_private.create_app_session(
      v_identity_principal_id,
      p_token_hash,
      p_request_id
    );

    -- Freeze the application contract even if the lower-level primitive gains
    -- additional internal fields in a later append-only migration.
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'sessionId', v_session_result ->> 'sessionId',
      'principalId', v_session_result ->> 'principalId',
      'idleExpiresAt', v_session_result ->> 'idleExpiresAt',
      'absoluteExpiresAt', v_session_result ->> 'absoluteExpiresAt',
      'rotateAfter', v_session_result ->> 'rotateAfter'
    );
  exception
    when sqlstate 'P2B01' then
      return pg_catalog.jsonb_build_object('ok', false);
  end;
end;
$$;

create function app_private.authorize_admin_principal(
  p_principal_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, app_private
as $$
  select pg_catalog.jsonb_build_object(
    'ok', true,
    'authorized', exists (
      select 1
      from public.admin_user admin
      join app_private.principal principal
        on principal.id = admin.principal_id
      where admin.principal_id = p_principal_id
        and principal.status = 'active'
    )
  );
$$;

create function public.admit_admin_app_session(
  p_provider text,
  p_issuer text,
  p_subject text,
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
  return app_private.admit_admin_app_session($1, $2, $3, $4, $5);
end;
$$;

create function public.authorize_admin_principal(
  p_principal_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, app_private
as $$
begin
  perform app_private.require_rpc_role(array['service_role']);
  return app_private.authorize_admin_principal($1);
end;
$$;

revoke all on function app_private.admit_admin_app_session(text, text, text, bytea, uuid)
  from public, anon, authenticated;
revoke all on function app_private.authorize_admin_principal(uuid)
  from public, anon, authenticated;
revoke all on function public.admit_admin_app_session(text, text, text, bytea, uuid)
  from public, anon, authenticated;
revoke all on function public.authorize_admin_principal(uuid)
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
        'revoke all on all functions in schema app_private from %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.admit_admin_app_session(text,text,text,bytea,uuid) to %I',
        v_role
      );
      execute pg_catalog.format(
        'grant execute on function public.authorize_admin_principal(uuid) to %I',
        v_role
      );
    end if;
  end loop;
end
$acl$;

comment on function public.admit_admin_app_session(text, text, text, bytea, uuid) is
  'Trusted-service atomic administrator identity binding and five-family application-session admission boundary.';
comment on function public.authorize_admin_principal(uuid) is
  'Trusted-service active administrator Principal authorization boundary.';

notify pgrst, 'reload schema';
