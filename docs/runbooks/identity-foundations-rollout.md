# Identity foundations rollout and forward-fix runbook

This runbook deploys the additive Phase 2A schema in
[`migrations/018_identity_foundations.sql`](../../migrations/018_identity_foundations.sql)
under the contract in
[ADR 0002](../adr/0002-domain-identity-foundations.md).

It does not switch administrator authority, provision legacy users, enable
participant login, enforce product roles or ownership, change registration
states, or ship participant/administrator UI.

The mandatory release order is:

```text
reviewed commit and restored backup proof
  -> expand migration 018
  -> schema, ACL, replay, and old-application compatibility proof
  -> Phase 2A application image/canary
  -> observation
```

Never deploy application code that requires migration 018 before the expand
migration is recorded successfully. There is no Phase 2A contract migration.

## Safety invariants

Stop the rollout if any of these statements is false:

1. `public.admin_user.user_id` remains the sole current administrator
   allowlist. The nullable `admin_user.principal_id` bridge is not authority.
2. Existing `public.admin_user` and `public.player` rows keep
   `principal_id = null` after migration.
3. The rollout creates no Principal, AuthIdentity, profile, role assignment,
   team ownership, roster link, consent, or historical audit event for legacy
   data.
4. A bare `admin_user.user_id` is never treated as a complete identity
   namespace.
5. No script or operator invents an issuer from `CLOUDBASE_ENV_ID`, a hostname,
   deployment URL, username, or provider convention.
6. Existing `team`, `player`, registration RPC, capacity, publication, and
   `pending`/`approved`/`rejected` behavior are unchanged.
7. Rolling the application back leaves migration 018, its nullable columns,
   private tables, and resolver installed but inert. No down migration is run.

Record only aggregate or catalog evidence in the restricted release record.
Include operator and reviewer, repository commit, application image digest,
environment and database name, migration filename and reviewed checksum,
backup identifier and restore-test evidence, start/finish times, canary scope,
and go/abort decision. Do not record a database URL, credential, token,
identity tuple, contact, row dump, or audit metadata.

## Prerequisites and backup

1. Work from a clean, reviewed checkout of the immutable release commit.
2. Use the repository migration runner. Do not paste migration 018 into a web
   SQL editor, alter its checksum after application, or add it to a second
   provider-managed ledger.
3. Use a dedicated migration identity, compatible `psql`, provider-required
   TLS, and an independently configured expected database name. Do not use an
   application API key or a personal account.
4. Inject `MIGRATION_DATABASE_URL` from the secret store and
   `MIGRATION_EXPECT_DATABASE` independently. Never put the URL in command
   arguments, shell history, an issue, or a CI transcript.
5. Take a consistent provider/database backup immediately before deployment.
   Restore it into an isolated database and prove that migrations, row counts,
   and representative public/admin reads work there. A backup without a
   completed restore test is not a release gate.
6. Confirm capacity for the backup, six new tables, indexes, and normal write
   traffic. Agree on a canary, observation window, abort owner, and previous
   application image digest.

The general requirements in [`docs/migrations.md`](../migrations.md) remain
mandatory.

## Repository preflight

From the reviewed checkout, run the complete relevant suite against a
caller-owned disposable local stack. Start and migrate that stack first; the
identity SQL regression intentionally targets its `cs2cup` database:

```bash
set -euo pipefail
npm ci
npm run stack:up
npm run typecheck
npm run lint
npm run test:migration-checksum
npm run test:migration-state
npm run test:migrations
npm run test:security-boundaries
npm run test:identity-foundations
git diff --check
```

`stack:up` fails closed on a migration checksum mismatch. If a previous local
development run used a different, uncommitted 018 checksum, do not edit its
ledger: preserve any contributor data, or recreate only a confirmed disposable
stack before repeating this preflight.

`test:identity-foundations` must cover exact namespace behavior, constraints,
private-schema ACLs, the guarded resolver, nullable/no-backfill bridges, role
scope, owner/manager uniqueness, private profile defaults, append-only audit,
resolver idempotency, and true concurrent resolution.

Do not waive a failing test because the affected feature has no UI yet. These
foundations become later authorization and privacy boundaries.

## Target preflight

Connect through the runner's reviewed target handling. Verify the database name
without printing credentials:

```sql
select current_database(), to_regclass('public.schema_migration') as ledger;
```

If `ledger` is null on a genuinely fresh target, skip the following two ledger
queries until after `stack:migrate`; continue with the partial-schema detection
below. If it is present, run:

```sql
select phase, filename, checksum, applied_at
from public.schema_migration
order by phase, filename;

select phase, filename, checksum, applied_at
from public.schema_migration
where filename = '018_identity_foundations.sql';
```

`public.schema_migration` has no `version` column; the three-digit version is
part of `filename`. On an existing ledger before the first application, the
final query must return zero rows. If it returns the exact reviewed expand
ledger row, do not apply SQL manually: proceed to post-migration verification
and runner replay. If it returns a mismatched phase or checksum, stop. After a
fresh migration, run the same queries and require the exact reviewed row.

### Detect partial or unledgered schema

Run:

```sql
select
  to_regclass('app_private.principal') as principal,
  to_regclass('app_private.principal_identity') as principal_identity,
  to_regclass('app_private.principal_profile') as principal_profile,
  to_regclass('app_private.role_assignment') as role_assignment,
  to_regclass('app_private.team_ownership') as team_ownership,
  to_regclass('app_private.audit_event') as audit_event,
  to_regprocedure('public.ensure_principal_identity(text,text,text)') as resolver;

select table_schema, table_name, column_name, udt_name, is_nullable
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('public', 'admin_user', 'principal_id'),
  ('public', 'player', 'principal_id')
)
order by table_name;
```

Before an un-applied migration 018, all six relations, the resolver, and both
columns must be absent. `app_private` itself normally already exists from
migration 017. If any 018 object exists without the exact ledger entry, stop;
do not adopt, drop, rename, baseline, or manually complete it.

### Capture legacy aggregate invariants on an upgrade

If the target already has the application schema, capture these results in
restricted release evidence:

```sql
select count(*) as admin_user_count from public.admin_user;
select count(*) as team_count from public.team;
select count(*) as player_count from public.player;

select status, count(*)
from public.team
group by status
order by status;
```

On a genuinely blank target, these relations do not exist before migration.
Skip the aggregate queries and record that the legacy aggregate baseline is not
applicable for a fresh target. After migration, require empty foundation tables
and zero non-null bridge links, but do not invent a before/after business-row
comparison.

Do not export `admin_user.user_id`, captain, contact, notes, nickname, or token
claims. Record this explicit data decision:

```text
principal/identity backfill: forbidden
admin_user.principal_id backfill: forbidden
player.principal_id backfill: forbidden
role_assignment/team_ownership backfill: forbidden
profile/consent/audit-history synthesis: forbidden
issuer inference: forbidden
administrator authority after migration: public.admin_user.user_id
```

Any proposed exception requires a separate reviewed migration and verified
source evidence; operator familiarity is not verification.

## Apply the expand migration

Keep the previous application image serving while the migration runs:

```bash
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?inject from the secret store}"
: "${MIGRATION_EXPECT_DATABASE:?set independently}"
npm run stack:migrate
```

The runner verifies `current_database()`, obtains its migration advisory lock,
checks both append-only histories and checksums, applies migration 018 in one
transaction, and inserts this ledger key:

```text
(phase = expand, filename = 018_identity_foundations.sql)
```

No contract file corresponds to 018. Do not invent or expect an 018 contract.
If the release also has an independently approved contract from an earlier
migration, apply it only after that migration's canary/drain gates and runbook;
otherwise Phase 2A adds no contract operation.

Run `npm run stack:migrate` a second time from the same checkout. It must report
no pending expand migration, add no second ledger row, and change no business
data. A checksum mismatch or attempted replay is a blocker; never edit the
applied file or ledger to silence it.

## Post-migration schema verification

Run the following read-only checks through the approved administration
channel. Compare complete definitions to the reviewed migration; names alone
are not proof.

### Objects, RLS, policies, and empty foundations

```sql
select relation_name,
       to_regclass('app_private.' || relation_name) is not null as present
from unnest(array[
  'principal',
  'principal_identity',
  'principal_profile',
  'role_assignment',
  'team_ownership',
  'audit_event'
]) as listed(relation_name)
order by relation_name;

select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_private'
  and c.relname in (
    'principal',
    'principal_identity',
    'principal_profile',
    'role_assignment',
    'team_ownership',
    'audit_event'
  )
order by c.relname;

select schemaname, tablename, policyname
from pg_catalog.pg_policies
where schemaname = 'app_private'
  and tablename in (
    'principal',
    'principal_identity',
    'principal_profile',
    'role_assignment',
    'team_ownership',
    'audit_event'
  );

select
  (select count(*) from app_private.principal) as principals,
  (select count(*) from app_private.principal_identity) as identities,
  (select count(*) from app_private.principal_profile) as profiles,
  (select count(*) from app_private.role_assignment) as role_assignments,
  (select count(*) from app_private.team_ownership) as ownerships,
  (select count(*) from app_private.audit_event) as audit_events;
```

All relations must be present, all `relrowsecurity` values true, and the policy
query must return no rows. `relforcerowsecurity` is not asserted by migration
018; table owners are operational identities, not product callers. Before any
new application path is enabled, all six counts must be zero on an existing
deployment. A non-zero count means an unexpected writer or fabricated history;
stop the rollout.

### Bridges and legacy behavior

```sql
select table_name, column_name, udt_name, is_nullable
from information_schema.columns
where (table_schema, table_name, column_name) in (
  ('public', 'admin_user', 'principal_id'),
  ('public', 'player', 'principal_id')
)
order by table_name;

select
  count(*) filter (where principal_id is not null) as linked_admins,
  count(*) as total_admins
from public.admin_user;

select
  count(*) filter (where principal_id is not null) as linked_players,
  count(*) as total_players
from public.player;
```

Both bridge columns must be nullable UUIDs and both linked counts must be zero.
On an upgrade, the total administrator, team, player, and per-status counts
must match preflight. A fresh target has no preflight business-row baseline;
use the reviewed fresh-install migration result and still require zero linked
bridges and empty foundation tables.

Verify that migration 018 did not change the legacy state constraint or RPCs:

```sql
select conname, pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.team'::regclass
  and contype = 'c'
order by conname;

select p.oid::regprocedure as routine,
       p.prosecdef,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_catalog.pg_proc p
where p.oid in (
  to_regprocedure('public.registration_status(text)'),
  to_regprocedure('public.submit_team_rate_limited(text,jsonb)')
)
order by 1;
```

Compare definitions or reviewed checksums through restricted evidence rather
than pasting function bodies into a public issue.

### Constraints, indexes, triggers, and resolver

```sql
select c.relname as relation,
       x.conname,
       pg_get_constraintdef(x.oid) as definition
from pg_catalog.pg_constraint x
join pg_catalog.pg_class c on c.oid = x.conrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where (
    n.nspname = 'app_private'
    and c.relname in (
      'principal',
      'principal_identity',
      'principal_profile',
      'role_assignment',
      'team_ownership',
      'audit_event'
    )
  ) or (
    n.nspname = 'public'
    and c.relname in ('admin_user', 'player')
  )
order by c.relname, x.conname;

select column_name, collation_schema, collation_name
from information_schema.columns
where table_schema = 'app_private'
  and table_name = 'principal_identity'
  and column_name in ('provider', 'issuer', 'subject')
order by column_name;

select column_default
from information_schema.columns
where table_schema = 'app_private'
  and table_name = 'principal_profile'
  and column_name = 'visibility';

select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where (
    schemaname = 'app_private'
    and tablename in (
      'principal',
      'principal_identity',
      'principal_profile',
      'role_assignment',
      'team_ownership',
      'audit_event'
    )
  ) or (
    schemaname = 'public'
    and tablename in ('admin_user', 'player')
  )
order by tablename, indexname;

select n.nspname as schema_name,
       c.relname as table_name,
       t.tgname as trigger_name,
       pg_get_triggerdef(t.oid) as definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_private'
  and not t.tgisinternal
order by c.relname, t.tgname;

select p.oid::regprocedure as routine,
       p.prosecdef as security_definer,
       p.proconfig
from pg_catalog.pg_proc p
where p.oid in (
  to_regprocedure('app_private.ensure_principal_identity(text,text,text)'),
  to_regprocedure('public.ensure_principal_identity(text,text,text)')
)
order by 1;

select
  position('app_private.require_rpc_role' in p.prosrc) > 0 as has_claims_guard,
  position('app_private.ensure_principal_identity' in p.prosrc) > 0 as delegates
from pg_catalog.pg_proc p
where p.oid = to_regprocedure(
  'public.ensure_principal_identity(text,text,text)'
);
```

The output must prove the exact namespace uniqueness, built-in `C` collation
on all three namespace columns, status/deletion checks,
profile-private default and handle index, role enum/scope and active uniqueness,
one active Owner plus Manager support, RosterSlot bridge uniqueness, audit
actor/metadata checks and append-only triggers, private invoker implementation,
and guarded public definer wrapper. Do not expect a `command_id`, an audit-event
deduplication constraint, or general command idempotency: migration 018 does
not implement them.

### ACL and guarded-RPC verification

For each role that exists, prove that no gateway/application role can use the
private schema or tables directly:

```sql
select r.rolname,
       has_schema_privilege(r.rolname, 'app_private', 'USAGE') as schema_usage,
       c.relname,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete
from pg_catalog.pg_roles r
cross join pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where r.rolname in ('anon', 'authenticated', 'club_admin', 'service_role')
  and n.nspname = 'app_private'
  and c.relname in (
    'principal',
    'principal_identity',
    'principal_profile',
    'role_assignment',
    'team_ownership',
    'audit_event'
  )
order by r.rolname, c.relname;

select r.rolname,
       p.oid::regprocedure as private_routine,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_catalog.pg_roles r
cross join pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where r.rolname in ('anon', 'authenticated', 'club_admin', 'service_role')
  and n.nspname = 'app_private'
order by 1, 2;

select r.rolname,
       has_function_privilege(
         r.rolname,
         'public.ensure_principal_identity(text,text,text)',
         'EXECUTE'
       ) as can_execute_public_resolver
from pg_catalog.pg_roles r
where r.rolname in ('anon', 'authenticated', 'club_admin', 'service_role')
order by r.rolname;
```

Every private-schema, private-table, and private-routine flag must be false.
`anon` and `authenticated` must not have SQL EXECUTE on the public resolver.
Migration 018 may grant SQL
EXECUTE to `club_admin` and `service_role` for transport compatibility, but the
wrapper still admits only a verified `request.jwt.claims.role = service_role`
(or the repository's local trusted authenticator path). SQL EXECUTE alone is
not authorization.

Through the actual staging gateway, calls with missing, malformed, `anon`,
`authenticated`, or `club_admin` claims must fail with SQLSTATE `42501`; only
the trusted service path may reach identity resolution. Direct table requests
must fail without revealing whether a guessed Principal or identity exists.

## Idempotency and concurrency gate

Never run write or race probes on production. The current
`test:identity-foundations` suite provides automated evidence for exactly these
behaviors:

1. Repeating `public.ensure_principal_identity` with the same exact valid tuple
   returns the same `principalId`; only the first result has `created = true`.
2. Eight concurrent first resolutions of that tuple leave exactly one
   Principal, one AuthIdentity, and one `principal.created` audit event.
3. A different issuer and a case-variant subject remain distinct; malformed,
   padded, or control-character namespace input is rejected.
4. Missing, malformed, and unauthorized gateway claims cannot reach the
   resolver.
5. Resolving a binding attached to a deleted Principal fails with `55000`
   without creating a replacement, appending an audit event, or refreshing
   `last_verified_at`.
6. Database constraints reject invalid role scope, a duplicate active role, a
   second active Owner, a duplicate Principal/entry relationship, and a
   duplicate linked RosterSlot; the tests also prove that an Owner and a Manager
   can coexist. These are single-transaction constraint probes, not concurrent
   role/ownership races.
7. The creation audit event has actor type `system`, null actor Principal,
   empty metadata, and no issuer or subject. Actor/metadata constraints and
   append-only update, delete, and truncate triggers are exercised; the
   retained tournament foreign key also rejects hard deletion of a referenced
   tournament.

The suite does **not** currently exercise a suspended Principal lookup or
concurrent role-assignment and ownership writers. Do not record those as CI
coverage. Before enabling a path that depends on those behaviors, use an
approved disposable staging database (or add a reviewed automated test) to
prove:

- a suspended Principal resolves to the same ID but receives no application
  session;
- concurrent duplicate active role assignments leave one active row;
- concurrent competing Owners leave one active Owner while distinct Managers
  remain possible; and
- an induced failure after a foundation write rolls back every Principal,
  identity, role, ownership, and audit change in that transaction.

The identity resolver's advisory lock and namespace constraint are its
idempotency mechanism. `audit_event.request_id` is nullable correlation only;
do not test or advertise nonexistent audit-command deduplication.

Fixtures must use generated synthetic provider-safe values, issuers, subjects,
Principals, tournaments, and entries. Never copy a production subject or
contact into a fixture or log. Run write probes only on a database that will be
destroyed and recreated through the normal staging process; append-only audit
events are not cleanup targets.

## Expand-before-application compatibility gate

Before deploying the Phase 2A image, run the **previous** production image
against the migrated disposable staging database and verify:

- public home, tournament, team, roster, registration-status, media, sitemap,
  feed, and search routes retain their prior responses;
- a disposable anonymous registration is created in legacy `pending`, consumes
  capacity exactly as before, and creates no Principal, identity, profile,
  ownership, role assignment, bridge link, or audit event;
- a whitelisted administrator can still sign in and perform existing console
  operations without `admin_user.principal_id`; and
- a valid but non-whitelisted token cannot enter the console even if a
  synthetic Principal has a `platform_admin` assignment.

This behavior proof, not merely a successful process start, establishes that
migration 018 is additive.

## Phase 2A staging and canary verification

Deploy the reviewed image by immutable digest to disposable staging, then a
small production canary. Verify:

1. The application starts and serves existing behavior with every foundation
   table empty.
2. `lib/auth.ts` still authorizes administrators solely through
   `admin_user.user_id`; neither the Principal bridge nor `platform_admin`
   changes the result.
3. The trusted resolver returns only `ok`, `principalId`, and `created`, treats
   issuer and subject as exact/case-sensitive, and never falls back to a
   subject-only match.
4. Public and authenticated callers cannot enumerate or mutate any private
   foundation relation or call the resolver.
5. Existing anonymous registration, seat counting, approved public rosters,
   and three-state administrator review remain unchanged.
6. Logs contain stable error/correlation information but no credential,
   identity tuple, contact, roster payload, full request body, or audit
   metadata.
7. The CI-equivalent migration, security-boundary, foundation, application,
   accessibility, and browser suites pass against the migrated database.

If this Phase 2A image contains no explicit resolver integration—as this ADR's
boundary permits—the normal production expectation is still zero foundation
rows. Exercise the resolver only in disposable staging through the test suite;
do not create a production fixture merely to prove reachability.

## Observation and abort signals

Shift traffic gradually and monitor aggregate metrics during the agreed window:

- legacy token-verification and `admin_user` allowlist failures;
- resolver `42501`, `22023`, and `55000` errors by code only;
- unexpected namespace conflicts, role-scope or ownership-uniqueness failures;
- database transaction errors, lock waits, connection saturation, and latency;
- anonymous registration success, capacity, and rate-limit behavior;
- public 403/404 changes and any report of private-data exposure; and
- counts of each foundation table and non-null bridge column.

Unexpected foundation rows, bridge population, changed administrator access,
or changed registration/publication behavior are abort signals. Do not
diagnose them by dumping identities or private rows into logs.

## Application rollback and forward fix

For an application incident:

1. Stop the traffic shift and disable the new application path or feature flag.
2. Route traffic to the recorded previous image digest.
3. Verify that the previous image still authenticates through
   `public.admin_user.user_id` and that legacy registration and public reads
   are healthy.
4. Leave these objects in place:
   - all six `app_private` foundation tables;
   - `public.admin_user.principal_id` and `public.player.principal_id`;
   - `public.ensure_principal_identity(text,text,text)` and private helpers;
   - the expand/`018_identity_foundations.sql` ledger row and checksum.
5. Preserve aggregate/catalog evidence and correct the defect in a new
   application commit or a new forward migration (normally 019 or later).

The old image ignores these additive objects, so leaving them installed keeps
them inert. Do not drop or truncate tables, delete the ledger row, edit migration
018, fabricate a reverse identity mapping, revoke constraints, or delete audit
evidence to recover traffic. If trusted resolver calls already created rows,
the previous image still ignores them; retain them for review and forward-fix
their lifecycle explicitly.

If a database defect prevents even the previous image from operating, stop
writes and convene the database, security, and incident owners. Prefer a
narrowly reviewed forward migration. Restoring the verified pre-deploy backup
is a last-resort disaster-recovery decision because it discards legitimate
writes made after that backup; use the approved recovery procedure, not an ad
hoc Phase 2A script.

Rollback is complete only when the previous image is healthy, the foundation
objects are inert, current authority and legacy behavior are reverified, and
the release record names the forward-fix owner and next decision point.
