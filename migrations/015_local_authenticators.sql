-- Local PostgREST connects through dedicated authenticators and then switches
-- to the request role. Managed CloudBase environments may reject CREATE ROLE;
-- in that case their platform-provided database identities remain in use.
do $migration$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon_authenticator') then
    begin
      create role anon_authenticator
        nologin
        nosuperuser
        nocreatedb
        nocreaterole
        noinherit
        noreplication
        nobypassrls;
    exception
      when insufficient_privilege or feature_not_supported then
        raise notice 'CREATE ROLE is unavailable; skipping anon_authenticator setup';
    end;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'admin_authenticator') then
    begin
      create role admin_authenticator
        nologin
        nosuperuser
        nocreatedb
        nocreaterole
        noinherit
        noreplication
        nobypassrls;
    exception
      when insufficient_privilege or feature_not_supported then
        raise notice 'CREATE ROLE is unavailable; skipping admin_authenticator setup';
    end;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon_authenticator') then
    alter role anon_authenticator
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    grant anon to anon_authenticator;
  end if;

  if exists (select 1 from pg_roles where rolname = 'admin_authenticator')
    and exists (select 1 from pg_roles where rolname = 'club_admin')
  then
    alter role admin_authenticator
      nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
    grant club_admin to admin_authenticator;
  end if;
exception
  when insufficient_privilege or feature_not_supported then
    raise notice 'Authenticator role configuration is unavailable; skipping local setup';
end
$migration$;
