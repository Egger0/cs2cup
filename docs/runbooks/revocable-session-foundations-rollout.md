# Revocable session foundations rollout and forward-fix runbook

This runbook deploys the additive Phase 2B.2 foundations in
[`migrations/019_revocable_session_foundations.sql`](../../migrations/019_revocable_session_foundations.sql)
under [ADR 0004](../adr/0004-revocable-session-foundations.md).

It installs private SessionFamily, token-digest, dual-dimension throttle, audit,
and guarded service-RPC behavior. It does **not** switch login or logout,
change the current cookie, invoke these RPCs from the application, retire the
CloudBase credential, alter administrator authority, or enable participant
identity. Production 019 tables are expected to remain empty throughout this
release.

The uppercase terms **MUST**, **MUST NOT**, **SHOULD**, and **SHOULD NOT** have
the meanings in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174). Operational rules use
stable `SESSION-RUN-NNN` identifiers. Do not renumber or reuse an identifier.

The mandatory release order is:

```text
reviewed immutable commit and verified restore
  -> repository and disposable-database acceptance matrix
  -> migration 019 on the target while the old image remains live
  -> ledger, schema, ACL, empty-state, replay, and old-image proof
  -> inert Phase 2B.2 image/canary
  -> observation with zero 019 business rows
```

There is no 019 contract or down migration. Phase 2B.3 has its own later
cutover gate and is not part of this sequence.

## Stop conditions and evidence boundary

Stop before or during rollout if any statement is false:

1. Current authentication and the current cookie are unchanged by the reviewed
   Phase 2B.2 diff.
2. `public.admin_user.user_id` remains the current administrator allowlist.
3. Migration 019 creates no family, token, throttle, or audit row and does not
   backfill existing Principals.
4. The old application starts and serves its complete current behavior against
   the migrated schema.
5. Only 32-octet digests/fingerprints can enter the three 019 relations and 019
   RPC credential/throttle parameters; no raw token, provider credential,
   account identifier, or IP address enters those objects. Existing migration
   018 provider/issuer/subject identity columns remain governed by ADR 0002 and
   are not session-token storage.
6. Every public 019 wrapper admits only the trusted `service_role` claim in its
   function body; transport `EXECUTE` alone grants no authority.
7. Application rollback leaves migration 019 and its ledger row installed but
   unused. No operator will run a down script, edit 019, or alter its checksum.

- `SESSION-RUN-001`: The release record MUST contain only aggregate or catalog
  evidence: operator and independent reviewer, repository commit, image digest,
  environment and independently verified database name, migration filename and
  reviewed checksum, backup/restore identifiers, start/finish times, canary
  scope, test results, and go/abort decision.
- `SESSION-RUN-002`: The release record, terminal transcript, CI artifact, and
  incident channel MUST NOT contain a database URL, password, raw token,
  digest, fingerprint, provider issuer/subject, IP address, cookie, JWT claims,
  private row dump, or audit metadata.
- `SESSION-RUN-003`: Any production 019 family, token, throttle, or new session
  audit row during Phase 2B.2 is an abort signal. Do not create a production
  fixture merely to prove reachability.

## Prerequisites, backup, and restored rehearsal

1. Work from a clean, reviewed checkout of the exact immutable release commit.
   Confirm migration 019 and both session documents are included in the review.
2. Use [`scripts/migrate.mjs`](../../scripts/migrate.mjs) as the only migration
   system. Do not paste SQL into a provider editor or combine this ledger with a
   second provider-managed ledger.
3. Use compatible `psql`, provider-required TLS, and a dedicated migration
   identity. Inject `MIGRATION_DATABASE_URL` from the secret store and set
   `MIGRATION_EXPECT_DATABASE` independently; never place credentials in a
   command argument or shell history.
4. Take a consistent target backup immediately before rollout. Restore it to an
   isolated database and prove that representative public/admin reads, existing
   writes, migration, replay, and the previous image work there. A backup
   without a completed restore test does not satisfy this gate.
5. Record the previous production image digest, rollback owner, observation
   window, maintenance decision, and a database/security escalation owner.
6. Confirm that no scheduler, Worker, application feature flag, or manually
   invoked job will call an 019 RPC in production during Phase 2B.2.

Migration 019 creates private tables, indexes, and functions but does not scan
or rewrite legacy business tables. It still acquires PostgreSQL DDL/catalog
locks and sets a local five-second lock timeout. Rehearse on the restored,
production-sized database under representative write traffic; record duration,
lock waits, and the longest observed application pause rather than assuming
that “additive” means lock-free.

- `SESSION-RUN-004`: Backup acceptance MUST include a completed isolated
  restore and previous-image behavior proof. Schema-only inspection or a
  provider status badge is insufficient.
- `SESSION-RUN-005`: Production RPC scheduling and application integration MUST
  remain disabled. Only disposable staging tests may create synthetic 019 rows
  in this release.

The general controls in [`docs/migrations.md`](../migrations.md) remain
mandatory.

## Repository preflight

Run the final repository gate from the reviewed checkout against a caller-owned
disposable local stack. The block below is intentionally self-contained: it
uses a unique Compose project, seeds the database, builds and packs the
production application, owns the application process it tests, proves that
process is healthy, and cleans up on every exit. Ports `3000`, `53000`, `53001`,
and `55432` must be free before it starts.

```bash
set -euo pipefail

# Refuse repository-local environment overlays and remove inherited deployment
# controls before any package, Compose, seed, migration, build, or test command.
# This harness must never follow a production database URL or test a stale app.
for preflight_env_file in .env .env.local .env.production .env.production.local; do
  if [[ -e "${preflight_env_file}" ]]; then
    echo "remove ${preflight_env_file} from this disposable checkout" >&2
    exit 1
  fi
done
unset \
  CLOUDBASE_ADMIN_KEY \
  CLOUDBASE_ANON_KEY \
  CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING \
  CLOUDBASE_SMOKE_EXPECT_ENV_ID \
  COMPOSE_PROFILES \
  HOME_PREVIEW_COUNTDOWN \
  MIGRATION_DATABASE_URL \
  MIGRATION_ENABLE_TEST_CONTROLS \
  MIGRATION_EXPECT_DATABASE \
  MIGRATION_PSQL_BIN \
  MIGRATION_TEST_MAX_VERSION \
  NEXT_PHASE \
  NODE_ENV \
  PORT \
  HOSTNAME

preflight_root="$(mktemp -d)"
preflight_pid=""
export COMPOSE_FILE="${PWD}/compose.yaml"
export COMPOSE_PROJECT_NAME="cs2cup-session-preflight-$$"
preflight_cleanup() {
  if [[ -n "${preflight_pid}" ]] && kill -0 "${preflight_pid}" 2>/dev/null; then
    kill "${preflight_pid}" 2>/dev/null || true
    wait "${preflight_pid}" 2>/dev/null || true
  fi
  npm run stack:down >/dev/null 2>&1 || true
  rm -rf -- "${preflight_root}"
}
trap preflight_cleanup EXIT HUP INT TERM

export CI=1
export NEXT_TELEMETRY_DISABLED=1
export CLOUDBASE_ENV_ID=dev-env
export CLOUDBASE_ISSUER=http://127.0.0.1:53100
export RDB_BASE_URL=http://127.0.0.1:53000
export RDB_ADMIN_BASE_URL=http://127.0.0.1:53001
export E2E_BASE_URL=http://127.0.0.1:3000
export E2E_RDB_BASE_URL=http://127.0.0.1:53000
export BASE_URL=http://127.0.0.1:3000
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000
export PHOTO_UPLOAD_DRIVER=local
export PHOTO_LOCAL_ROOT="${preflight_root}/photos"
export REGISTRATION_FINGERPRINT_SECRET=preflight-only-registration-secret-2026
export REGISTRATION_CLIENT_IP_SOURCE=x-real-ip
export MIGRATION_DB_NAME=cs2cup
export MIGRATION_REQUIRE_EXTERNAL_TEST=1
export SEED_DB_NAME=cs2cup
export TEST_DB_NAME=cs2cup
mkdir -p "${PHOTO_LOCAL_ROOT}" "${preflight_root}/artifacts"

npm ci
npx playwright install chromium
npm run stack:up
npm run stack:seed
npm run test:session-token
npm run test:migration-checksum
npm run test:migration-state
npm run test:migrations
npm run test:security-boundaries
npm run test:identity-foundations
npm run test:session-foundations
npm run typecheck
npm run lint
npm run build
node scripts/pack-standalone.mjs

NODE_ENV=production HOSTNAME=127.0.0.1 PORT=3000 \
  node .next/standalone/server.js \
  >"${preflight_root}/artifacts/application.log" 2>&1 &
preflight_pid="$!"
for _ in {1..60}; do
  if ! kill -0 "${preflight_pid}" 2>/dev/null; then
    cat "${preflight_root}/artifacts/application.log"
    exit 1
  fi
  if curl --fail --silent http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 1
done
kill -0 "${preflight_pid}"
curl --fail --silent http://127.0.0.1:3000/ >/dev/null

npm run check
git diff --check
```

`npm run check` is the complete merge/release command only while its seeded
PostgREST stack and the production application owned by this harness are live;
running it against an undeclared or stale service on port 3000 is invalid
evidence. The explicit commands above make session evidence visible in the
release record, so their duplicate execution inside `check` is intentional.
`stack:up` applies expand and eligible contract migrations before database
regressions. CI MUST independently reproduce the same lifecycle through the
pinned jobs in [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml),
including dependency installation, stack seed, build/pack, isolated admin E2E,
owned application startup and health check, public E2E, accessibility, keyboard,
performance, diagnostics, and unconditional service cleanup.

The token-codec test MUST prove:

- exactly 32 CSPRNG bytes become exactly `v1.` plus 43 canonical unpadded
  base64url characters;
- padding, whitespace, Unicode, wrong prefix/case/length/alphabet, and
  non-canonical final characters fail without echoing the input;
- fixed independent vectors prove
  `SHA-256(UTF-8("cs2cup-session-v1\0") || UTF-8(complete token))`;
- the digest transport represents exactly 32 bytes and includes the token
  version and domain; and
- generation fails closed if Web Crypto randomness or SHA-256 is unavailable.

`test:session-foundations` MUST combine a rollback-only SQL regression with an
isolated deterministic concurrency harness. It must cover every Phase 2B.2
database rule; application/browser rules explicitly assigned to Phase 2B.3
remain cutover gates rather than claims about this database-only test.

- `SESSION-RUN-006`: A failing session, migration, security-boundary, old-image,
  or complete `npm run check` gate MUST block rollout. “Inert” is not a reason
  to waive a failure.

## Mandatory migration lifecycle matrix

[`scripts/migration-lifecycle-test.mjs`](../../scripts/migration-lifecycle-test.mjs)
must exercise these paths with separate disposable databases:

| Path | Setup | Required evidence |
|---|---|---|
| Fresh | empty PostgreSQL database | all migrations through 019 apply; one exact expand ledger row; all 019 relations empty; no fabricated session audit |
| 018 upgrade | migrate only through 018, insert synthetic 018 Principal/identity/audit sentinels, then run head | those 018 sentinel rows remain unchanged; 019 objects exist and remain empty |
| Legacy adoption | reproduce the supported unledgered main/012 schema, add legacy sentinels, run the existing reviewed `--baseline 012`, then migrate head | only 001–012 are adopted; 013–019 execute normally; historical seeds are not replayed; 019 is empty |
| Replay | run head a second time after capturing the ledger and empty counts | no second ledger row, session data, session audit, or checksum drift |
| Late failure | migrate through 018, create an incompatible object matching the deliberately late 019 wrapper, then run head | transaction fails; every preceding 019 table/index/private function/wrapper and the ledger row is absent; the conflict and 018 sentinels remain; no 019 ACL delta exists because ACL statements follow the injected failure; removing the conflict allows clean recovery |
| Concurrent runners | start two normal runners against the same 018 database | migration advisory lock serializes them; exactly one complete 019 schema and ledger row result |

The only supported adoption marker is 012. An unledgered 018 or partial 019
schema is not an adoption candidate. Do not add `--baseline 018`, baseline 019,
manual ledger insertion, object renaming, or a checksum exception.

- `SESSION-RUN-007`: Fresh, 018-upgrade, 012-adoption, replay, late-failure, and
  concurrent-runner paths MUST all pass before 019 is released.
- `SESSION-RUN-008`: Late-failure proof MUST verify rollback of every 019 object
  created before the deliberate fault, absence of later ACL effects and the 019
  ledger row, and preservation of the conflict and 018 sentinels. It proves
  transactional DDL rollback plus final-state ACL absence; it does not claim
  that statements following the fault executed. Recovery MUST use the same
  immutable migration after the synthetic conflict is removed.
- `SESSION-RUN-009`: No target newer than the reviewed 012 legacy baseline may
  be adopted. Partial or unledgered 018/019 state is an incident requiring
  catalog comparison and a separately reviewed forward recovery.

## Session functional and concurrency acceptance

All write and race probes use generated synthetic Principals, UUID request IDs,
digests, fingerprints, and timestamps in disposable databases. Never reuse a
production identifier, address, token, or account.

### Schema, state, and exact time boundaries

The SQL regression must prove:

1. Family/token/throttle columns, defaults, nullability, foreign-key actions,
   named constraint types, 32-octet checks, exact index inventory and structural
   properties, RLS/no-policy state, required comment presence, public-wrapper
   search paths, and public function signatures match the reviewed 019
   structural contract. This automated inventory is not represented as a byte-
   for-byte comparison of every catalog definition or comment body.
2. Creation admits only an active Principal and creates one family, one current
   digest, and one `session.created` audit. Suspended, deleted, missing, invalid
   digest, and null request ID paths leave no state.
3. At creation, idle is exactly 30 minutes, absolute exactly eight hours, and
   rotation exactly 15 minutes from the same lock-owned database timestamp.
4. Every successful current or valid-grace use changes `last_seen_at` to that
   operation's database time and sets idle to exactly the lesser of 30 minutes
   later and absolute expiry. Two successful requests must produce two touches;
   there is no sampling allowance.
5. Equality is closed: idle, absolute, grace, block, and retention checks use
   `now >= boundary`. Fixtures should set database-owned timestamps around the
   boundary; do not use wall-clock sleeps as the primary proof.
6. A due current token rotates once: any old grace becomes retired, old current
   becomes grace for at most 60 seconds, the supplied replacement becomes the
   sole current, rotation count increments, and one audit commits.
7. Valid grace use touches but cannot rotate. Against an otherwise live family
   and active Principal, retired or expired-grace use revokes the complete
   family as `token_reuse`, appends one `session.revoked` event with that
   constrained reason, and returns the same generic denial as another unusable
   digest. An already revoked/expired family receives no second terminal event.
8. Unknown, revoked, idle-expired, absolute-expired, inactive-Principal, and
   replay paths return no Principal/session existence distinction or credential
   material.

### Split revocation RPCs

The tests must call and distinguish these exact guarded entry points:

```text
public.logout_app_session(bytea, uuid)
public.revoke_app_session(uuid, uuid, text, uuid)
public.revoke_principal_sessions(uuid, uuid, uuid, text, uuid)
```

Required behavior:

- logout accepts a token digest, derives the family/Principal internally,
  applies only reason `logout`, audits that Principal, and is an idempotent
  no-op for unknown/already revoked state;
- administrative single revocation accepts an internal family UUID, never a
  digest; reason `administrator` requires an existing active actor Principal;
  `security_event` permits an existing actor of any status or null system actor;
- Principal-wide revocation locks all distinct actor/target Principals in UUID
  order, then live families in UUID order; an exception must belong to the
  target; every changed family gets one `session.revoked` audit;
- Principal-status revocation requires a non-active target and null actor;
  administrator revocation requires an active actor; security-event actor
  may be an existing Principal of any status or null system; and
- repeats preserve the original timestamp/reason and append no duplicate audit.

Malformed actor/reason/exception combinations fail with stable validation
errors without changing any family.

### Dual-dimension throttle

The Phase 2B.2 database tests must prove:

- both RPC fingerprints are exactly 32 bytes and every other byte length is
  rejected; keyed derivation and rejection of raw/reversibly encoded adapter
  inputs remain Phase 2B.3 tests because migration 019 never receives them;
- account and network rows are always acquired account-first in one transaction;
- attempts 1–5 for one account are allowed and attempt 6 blocks it for exactly
  15 minutes;
- attempts 1–30 for one network are allowed and attempt 31 blocks it for exactly
  15 minutes;
- the returned retry delay is the rounded-up maximum active delay and reveals
  neither account existence nor which dimension blocked;
- the clear primitive deletes only the account row and leaves the network
  row/count unchanged; adapter ordering after committed session creation
  remains a Phase 2B.3 test;
- concurrent clear/cleanup between insert conflict detection and row locking
  retries until the attempt owns and updates a stable row;
- distinct account and network fingerprints do not collide or interfere; and
- window rollover and block equality reset exactly without timestamp sleeps or
  manual production clock changes.

### Audit transaction and privacy

Inject targeted late failures across lifecycle and migration paths and prove
the affected family, token, throttle, and audit changes roll back together.
Any future mutation branch requires its own failure-injection regression.
Verify exact action/reason/actor/request-ID
semantics for `session.created`, `session.rotated`, `session.revoked`, and
`session.expired`, including the `token_reuse` revocation reason.

The Phase 2B.2 SQL regression must inspect SQLSTATE, message, `DETAIL`, `HINT`,
and `CONTEXT` for synthetic runtime digest and account/network fingerprint
failures. Its database/codec harness stdout and stderr and the resulting CI
artifacts must contain none of those fixtures. Harness failure summaries must
redact runtime digests and digest-keyed maps before serialization. Public fixed
codec vectors are the only allowed non-secret digest evidence. Audit metadata
may contain only the constrained reason or rotation number specified by ADR
0004. Migration 019 has no application caller in this release, so provider
tuples, IP fixtures, cookies, HTTP errors, and application log propagation are
not falsely claimed as exercised here; Phase 2B.3 must capture and search every
adapter, HTTP, application, and CI failure surface before cutover.

### Deterministic race matrix

Use persistent named `psql` sessions and a deliberate holder transaction. Poll
`pg_stat_activity`/`pg_locks` until waiters are proven blocked on the intended
row or advisory lock before releasing the holder. A bare `Promise.all` without
a proven barrier is insufficient for session linearizability evidence.

| Race | Required final state |
|---|---|
| same due current digest, distinct replacement digests | exactly one replacement is current, presented digest is grace, all other candidates are absent, one rotation count/audit; waiters re-read under the family lock |
| successful use versus logout | one serialization order; no use ordered after committed logout succeeds; one terminal state/audit |
| rotation versus administrative revoke | one observable order; no active successor survives a revocation ordered after rotation; no orphan token/audit |
| rotation/logout versus Principal-wide revoke | Principal lock is reached before either family lock; the audit actor foreign key creates no reverse edge or `40P01` deadlock |
| actor suspension versus single/bulk administrator revoke | the actor lock determines one order; suspension first rejects the revoke, revoke first freezes an active actor through commit |
| session create versus Principal-wide/status revoke | shared Principal-first order prevents a newly admitted family from escaping the revocation decision |
| repeated concurrent logout/revoke | one state transition and one audit; all repeats are stable no-ops |
| twelve attempts on one account/network pair | exactly five allowed and seven limited by the account dimension; persisted counts/blocks match the fixed policy |
| overlapping account/network pairs | account row is always acquired before network; no deadlock, partial counter, or bypass |
| account consume versus account clear/cleanup | insert-to-lock deletion gaps retry until a stable row is owned; the committed order either records the attempt or clears it later, never a partial free attempt |
| cleanup versus live family operation | cleanup skips the locked family, deletes another eligible row within limit, and a later call converges |
| two cleanup workers | disjoint claimed batches, no duplicate expiry audit, each relation deletes no more than its requested limit |

- `SESSION-RUN-010`: Functional and race tests MUST assert committed catalog and
  row state, audit cardinality, deadlines, and absent candidates—not only RPC
  return JSON.
- `SESSION-RUN-011`: Concurrency proof MUST use deterministic lock waiters and
  operation names, timeouts, cleanup, and post-state assertions. Flaky timing
  success is not acceptance evidence.

## Bounded cleanup rehearsal

`public.cleanup_app_sessions(integer, uuid)` is installed but not scheduled in
production during Phase 2B.2. Rehearse it only on a disposable database with
synthetic rows.

The rehearsal must prove:

1. limits `0`, negative, null, and `1001` fail; limits `1` through `1000` are
   accepted;
2. one PostgreSQL clock value is sampled before either non-blocking candidate
   claim and is used for both relation batches and expiry audit timestamps;
3. a revoked family is retained until 24 hours after `revoked_at`;
4. an unrevoked idle- or absolute-expired family is retained until 24 hours
   after the earliest expiry, then receives exactly one `session.expired`
   event atomically in the same statement/transaction as deletion;
5. deleting a family cascades its current/grace/retired digest rows but leaves
   append-only audit evidence;
6. throttle state is retained until 24 hours after `updated_at`, and an active
   `blocked_until` prevents deletion even if the row is otherwise old;
7. one call removes at most `limit` families and at most `limit` throttle rows;
8. deterministic oldest-first ordering selects the batch;
9. a separately locked eligible row is skipped with `FOR UPDATE SKIP LOCKED`
   and remains for a later successful batch; and
10. concurrent workers claim disjoint rows and converge after repeated bounded
   calls.

The caller records only returned counts, duration, lock-wait aggregates, and
whether more work remains. It never exports candidate IDs, digests, throttle
keys, or audit bodies.

- `SESSION-RUN-012`: Cleanup scheduling MUST remain disabled until Phase 2B.3
  defines its authenticated scheduler, maximum loop/time budget, monitoring,
  retry policy, and overlap behavior. No generic `DELETE` or truncate job may
  substitute for the guarded bounded RPC.

## Target preflight

Connect through the approved direct PostgreSQL administration path. Verify the
database name without printing credentials:

```sql
select current_database(), to_regclass('public.schema_migration') as ledger;
```

If the ledger exists, inspect exact history:

```sql
select phase, filename, checksum, applied_at
from public.schema_migration
order by phase, filename;

select phase, filename, checksum, applied_at
from public.schema_migration
where filename in (
  '018_identity_foundations.sql',
  '019_revocable_session_foundations.sql'
)
order by filename, phase;
```

Before first application on a normal 018 target, require one reviewed 018
expand row and no 019 row. If the exact 019 row already exists, do not apply SQL
manually; verify checksum, proceed to post-migration checks, then run the normal
runner replay. A mismatched phase/checksum or missing historical row is a stop.

### Detect partial or unledgered 019 objects

```sql
select
  to_regclass('app_private.app_session') as app_session,
  to_regclass('app_private.app_session_token') as app_session_token,
  to_regclass('app_private.login_throttle') as login_throttle,
  to_regprocedure('public.create_app_session(uuid,bytea,uuid)') as create_rpc,
  to_regprocedure('public.use_app_session(bytea,bytea,uuid)') as use_rpc,
  to_regprocedure('public.logout_app_session(bytea,uuid)') as logout_rpc,
  to_regprocedure(
    'public.revoke_app_session(uuid,uuid,text,uuid)'
  ) as revoke_rpc,
  to_regprocedure(
    'public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'
  ) as revoke_principal_rpc,
  to_regprocedure('public.consume_login_attempt(bytea,bytea)') as throttle_rpc,
  to_regprocedure(
    'public.clear_login_account_throttle(bytea)'
  ) as throttle_clear_rpc,
  to_regprocedure(
    'public.cleanup_app_sessions(integer,uuid)'
  ) as cleanup_rpc;
```

Before an unapplied 019, every value must be null. If any object exists without
the exact 019 ledger entry, stop. Do not drop, rename, complete, baseline, or
adopt it. Preserve catalog-only evidence and escalate for a reviewed recovery.

### Capture aggregate compatibility invariants

On an upgrade target, capture aggregate counts without exporting row values:

```sql
select count(*) as principal_count from app_private.principal;
select count(*) as identity_count from app_private.principal_identity;
select count(*) as audit_count from app_private.audit_event;
select count(*) as admin_user_count from public.admin_user;
select count(*) as team_count from public.team;
select count(*) as player_count from public.player;
```

The first three may legitimately be nonzero after Phase 2A integration or
staging tests; migration 019 must not change them. Record only counts. On a
fresh target, record that before/after business-row comparison is not
applicable and require all foundation tables to be empty after migration.

- `SESSION-RUN-013`: Any unledgered 019 marker or count change caused by the
  migration is a stop condition. Operators MUST NOT repair it with manual DDL,
  ledger edits, or destructive cleanup.

## Apply migration 019

Keep the current production image serving while the expand migration runs:

```bash
set -euo pipefail
: "${MIGRATION_DATABASE_URL:?inject from the secret store}"
: "${MIGRATION_EXPECT_DATABASE:?set independently}"
npm run stack:migrate
```

The runner verifies `current_database()`, obtains the repository migration
advisory lock, validates expand and contract histories/checksums, executes the
complete file and ledger insert in one transaction, and records:

```text
(phase = expand, filename = 019_revocable_session_foundations.sql)
```

There is no 019 contract file. Do not run or invent one.

If PostgreSQL returns `55P03` from the local five-second lock timeout, keep the
old image live and verify that no 019 ledger row or object exists. Retry only in
the rehearsed lower-traffic window. Do not change the timeout, edit migration
019, or manually complete the file during incident response.

Run `npm run stack:migrate` again from the same checkout. It must report no
pending expand migration, write no second ledger row, and change no data or
catalog definition.

- `SESSION-RUN-014`: Successful application requires one exact ledger row and
  the reviewed normalized checksum. Failure requires no 019 object or ledger
  row. Either state is acceptable operationally; a partial state is not.

## Post-migration catalog and empty-state verification

Run read-only checks through the approved administration channel.

### Objects, RLS, policies, constraints, and indexes

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_private'
  and c.relname in ('app_session', 'app_session_token', 'login_throttle')
order by c.relname;

select schemaname, tablename, policyname, roles, cmd
from pg_catalog.pg_policies
where schemaname = 'app_private'
  and tablename in ('app_session', 'app_session_token', 'login_throttle')
order by tablename, policyname;

select c.conrelid::regclass as relation,
       c.conname,
       pg_catalog.pg_get_constraintdef(c.oid, true) as definition
from pg_catalog.pg_constraint c
where c.conrelid in (
  'app_private.app_session'::regclass,
  'app_private.app_session_token'::regclass,
  'app_private.login_throttle'::regclass
)
order by 1, 2;

select schemaname, tablename, indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'app_private'
  and tablename in ('app_session', 'app_session_token', 'login_throttle')
order by tablename, indexname;

select c.oid::regclass as relation,
       pg_catalog.obj_description(c.oid, 'pg_class') as comment
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'app_private'
  and c.relname in ('app_session', 'app_session_token', 'login_throttle')
order by c.oid::regclass::text;

select p.oid::regprocedure as routine,
       pg_catalog.obj_description(p.oid, 'pg_proc') as comment
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_app_session',
    'use_app_session',
    'logout_app_session',
    'revoke_app_session',
    'revoke_principal_sessions',
    'consume_login_attempt',
    'clear_login_account_throttle',
    'cleanup_app_sessions'
  )
order by p.oid::regprocedure::text;
```

Require RLS enabled, no request-role policies, exact reviewed checks and
indexes, one-current/one-grace partial uniqueness, and 32-octet digest and
fingerprint constraints. As a separate target-release review, compare the
complete `pg_get_constraintdef`, `indexdef`, function definition/configuration,
and comment values to immutable migration 019; object names alone are
insufficient. This target catalog comparison is deliberately stricter than the
automated structural inventory above and its reviewer is recorded under
`SESSION-RUN-001`.

### Exact RPC properties

```sql
select p.oid::regprocedure as routine,
       p.prosecdef,
       p.provolatile,
       p.proconfig,
       pg_catalog.pg_get_functiondef(p.oid) as definition
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('app_private', 'public')
  and p.proname in (
    'create_app_session',
    'use_app_session',
    'logout_app_session',
    'revoke_app_session',
    'revoke_principal_sessions',
    'consume_login_attempt',
    'clear_login_account_throttle',
    'cleanup_app_sessions'
  )
order by p.oid::regprocedure::text;
```

Require private implementations to be invoker functions and public wrappers to
be definer functions with fixed trusted search paths and an exact in-body
`service_role` guard. Verify split logout and administrative signatures; a
digest-based `revoke_app_session` overload or reason-bearing logout is a
blocker.

### Empty 019 state and unchanged legacy aggregates

```sql
select
  (select count(*) from app_private.app_session) as session_families,
  (select count(*) from app_private.app_session_token) as session_tokens,
  (select count(*) from app_private.login_throttle) as throttle_rows;

select count(*) as session_audit_rows
from app_private.audit_event
where action like 'session.%';
```

All four results must be zero for a production Phase 2B.2 rollout. Re-run the
pre-migration Principal, identity, audit, administrator, team, and player
aggregate queries and require unchanged counts. Migration 019 creates no audit
event by itself.

### ACL and claims smoke

For every role that exists, prove no direct private access:

```sql
select r.rolname,
       has_schema_privilege(r.rolname, 'app_private', 'USAGE') as schema_usage,
       c.relname,
       has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
       has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
       has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
       has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete,
       has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as can_truncate,
       has_table_privilege(r.rolname, c.oid, 'REFERENCES') as can_reference,
       has_table_privilege(r.rolname, c.oid, 'TRIGGER') as can_trigger,
       has_any_column_privilege(
         r.rolname, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
       ) as any_column_access
from pg_catalog.pg_roles r
cross join pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where r.rolname in (
    'anon', 'authenticated', 'club_admin', 'service_role'
  )
  and n.nspname = 'app_private'
  and c.relname in ('app_session', 'app_session_token', 'login_throttle')
order by r.rolname, c.relname;

select r.rolname,
       p.oid::regprocedure as private_routine,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_catalog.pg_roles r
cross join pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where r.rolname in (
    'anon', 'authenticated', 'club_admin', 'service_role'
  )
  and n.nspname = 'app_private'
order by r.rolname, p.oid::regprocedure::text;

select r.rolname,
       c.oid::regclass as private_sequence,
       has_sequence_privilege(
         r.rolname, c.oid, 'USAGE,SELECT,UPDATE'
       ) as sequence_access
from pg_catalog.pg_roles r
cross join pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where r.rolname in (
    'anon', 'authenticated', 'club_admin', 'service_role'
  )
  and n.nspname = 'app_private'
  and c.relkind = 'S'
order by r.rolname, c.oid::regclass::text;

with wrapper(signature) as (
  values
    ('public.create_app_session(uuid,bytea,uuid)'),
    ('public.use_app_session(bytea,bytea,uuid)'),
    ('public.logout_app_session(bytea,uuid)'),
    ('public.revoke_app_session(uuid,uuid,text,uuid)'),
    ('public.revoke_principal_sessions(uuid,uuid,uuid,text,uuid)'),
    ('public.consume_login_attempt(bytea,bytea)'),
    ('public.clear_login_account_throttle(bytea)'),
    ('public.cleanup_app_sessions(integer,uuid)')
), resolved as (
  select signature, to_regprocedure(signature) as oid
  from wrapper
)
select r.rolname,
       resolved.signature,
       has_function_privilege(r.rolname, resolved.oid, 'EXECUTE') as can_execute
from pg_catalog.pg_roles r
cross join resolved
where r.rolname in (
    'anon', 'authenticated', 'club_admin', 'service_role'
  )
order by r.rolname, resolved.signature;

-- PUBLIC is implicit role OID 0 and does not appear in pg_roles. These direct
-- ACL inspections must return zero rows for the reviewed objects.
select n.nspname, a.privilege_type
from pg_catalog.pg_namespace n
cross join lateral pg_catalog.aclexplode(
  coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
) a
where n.nspname = 'app_private'
  and a.grantee = 0;

select c.oid::regclass as private_relation, a.privilege_type
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral pg_catalog.aclexplode(c.relacl) a
where n.nspname = 'app_private'
  and c.relkind in ('r', 'S')
  and a.grantee = 0;

select p.oid::regprocedure as routine, a.privilege_type
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
cross join lateral pg_catalog.aclexplode(
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
) a
where n.nspname in ('app_private', 'public')
  and p.proname in (
    'create_app_session', 'use_app_session', 'logout_app_session',
    'revoke_app_session', 'revoke_principal_sessions',
    'consume_login_attempt', 'clear_login_account_throttle',
    'cleanup_app_sessions'
  )
  and a.grantee = 0;

select d.defaclobjtype, a.privilege_type
from pg_catalog.pg_default_acl d
join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
cross join lateral pg_catalog.aclexplode(d.defaclacl) a
where n.nspname in ('app_private', 'public')
  and d.defaclobjtype = 'f'
  and a.grantee = 0
  and a.privilege_type = 'EXECUTE';
```

Every reported private-access flag must be false. `anon` and `authenticated`
must also lack SQL execute on each public wrapper. `club_admin` and
`service_role` may have transport-compatible SQL execute where the deployed
gateway requires it; neither privilege is the authorization decision. Through
the actual disposable staging gateway, missing, malformed, `anon`,
`authenticated`, and `club_admin` claims must receive SQLSTATE `42501` from
every public 019 wrapper. A signed `service_role` claim may reach argument
validation; use deliberately malformed non-secret values and require `22023`,
not a write, for this smoke. Do not run a service-role write fixture in
production.

The repository's loopback-only local `admin_authenticator` is a test stand-in
for the service policy inside `require_rpc_role`; record it as local harness
evidence, never as another production claim or end-user authorization path.

CloudBase/PostgREST may require a transport-compatible SQL grant to expose a
wrapper, but the in-body claim guard remains authoritative. A successful SQL
privilege check does not waive the gateway claims test.

- `SESSION-RUN-015`: Catalog, ACL, gateway-claims, empty-state, and unchanged
  aggregate evidence MUST all pass. An object existing under a different
  signature, privilege, policy, search path, or definition is not equivalent.

## Expand-before-application compatibility gate

Run the previous production image by immutable digest against the migrated
restored/disposable database. Exercise the complete current flow:

- public home, feed, search, tournament, schedule, registration status, media,
  sitemap, and approved roster reads retain their prior behavior and cache
  boundaries;
- anonymous registration remains legacy `pending`, capacity and rate limiting
  are unchanged, and it creates no 019 state;
- a whitelisted administrator signs in, uses the existing console, and logs out
  through the current CloudBase credential/cookie path;
- a valid but non-whitelisted provider credential remains denied; and
- all three 019 tables and all `session.%` audit counts remain zero after the
  browser flows.

Repeat with the reviewed Phase 2B.2 image. Its externally observable results
and zero-state invariant must match the previous image. Inspect response
headers as required by ADR 0003; introducing a session foundation does not
permit private data or authentication results to enter a persistent cache.

- `SESSION-RUN-016`: Process start alone is not backward-compatibility proof.
  Previous and new images MUST complete current public/admin/browser behavior
  while producing zero 019 rows.

## Phase 2B.2 canary and observation

Deploy the reviewed Phase 2B.2 image by immutable digest to staging, then a
small production canary. Keep every future session integration and cleanup job
disabled. Verify:

1. current login, administrator allowlist, console operations, logout, and
   cookie behavior are unchanged;
2. no request calls an 019 RPC and no 019 relation gains a row;
3. no public schema or API description exposes private tables, digests, or
   fingerprints;
4. no new `42501`, `22023`, constraint, deadlock, lock-timeout, or migration
   errors appear outside deliberate disposable tests;
5. database connection, transaction, lock-wait, and latency metrics stay within
   the rehearsed envelope; and
6. new Phase 2B.2 application/database session logs contain no raw credential,
   token-like value, digest, fingerprint, provider tuple, IP address, cookie,
   claims object, or private RPC argument. Independently governed edge access
   logs are outside this release record and are not imported into session
   telemetry.

Observe legacy authentication success/failure, admin allowlist denial, public
403/404 changes, registration success/rate limiting, database health, 019 table
counts, and `session.%` audit count as aggregate signals. Any nonzero 019 count,
changed authority, private-data exposure, or unexpected RPC call is an abort.

## Application rollback and forward fix

For an application incident:

1. Stop the traffic shift and disable the new image/feature flag.
2. Route traffic to the recorded previous image digest.
3. Verify current CloudBase authentication, `public.admin_user.user_id`
   authority, legacy logout, registration, and public routes.
4. Verify the three 019 tables and `session.%` audit count remain zero.
5. Leave all migration 019 objects, ACLs, functions, ledger row, and checksum in
   place.
6. Record the incident, aggregate evidence, forward-fix owner, and next review.

If an unexpected caller already created 019 rows, do not delete them to make
the zero-state check pass. Disable the caller, preserve the private state and
append-only audit evidence, restrict incident access, and escalate for a
reviewed lifecycle/020 decision; the previous image still ignores the rows.

Do not drop or truncate a private table, delete a ledger row, edit migration
019, weaken an ACL/constraint, enable a direct table path, or restore the
pre-migration backup merely to remove inert objects. A schema defect is fixed
by an append-only migration 020 or later.

If a database defect prevents the previous image from operating, stop writes
and convene the database, security, and incident owners. Prefer a narrowly
reviewed 020 forward fix. Restoring the pre-deploy backup is a last-resort
disaster-recovery decision because it discards legitimate writes after the
backup; follow the approved recovery procedure rather than this rollout's
normal application rollback.

- `SESSION-RUN-017`: Normal rollback MUST retain the inert 019 schema and exact
  ledger/checksum. No down migration exists or may be improvised.
- `SESSION-RUN-018`: A database correction MUST be append-only, normally 020 or
  later. Backup restoration requires separate disaster-recovery authority and
  an explicit post-backup data-loss decision.

## Phase 2B.3 go/no-go handoff

Phase 2B.2 completion does not authorize session traffic. Before Phase 2B.3 can
cut over, its PR and rollout must independently prove:

- canonical `v1.<43 base64url>` generation and domain-separated digest vectors
  are used at every adapter boundary;
- the new cookie has reviewed `__Host-` naming, `Secure`, `HttpOnly`, exact
  `Path=/`, no `Domain`, reviewed `SameSite`, and an expiry no longer than the
  server family; cookie expiry is never server authorization;
- provider issuer/subject verification precedes exact identity resolution, and
  only an active Principal reaches create/use;
- the product either freezes and tests a per-Principal device/session cap or
  explicitly accepts migration 019's unbounded active-family risk; database
  enforcement is delivered only by a reviewed 020-or-later forward migration;
- account/network keyed fingerprints use separate versioned domains and a
  dedicated secret; `CF-Connecting-IP` is trusted only behind an exclusive
  Cloudflare-to-origin path, with direct origin bypass proven impossible;
- every candidate consumes both throttle dimensions and only complete login
  success clears account state;
- create/use/logout/admin/principal-revoke adapters use the split exact RPCs,
  preserve service-only claims, emit private no-store responses, and do not log
  credentials;
- each use keeps its raw replacement candidate in request-local memory, sets it
  only when that same RPC returns `rotated`, and discards it for `active`,
  `grace`, denial, or error;
- exact touch, equality expiry, rotation, grace/replay, logout, administrator
  action, Principal suspension, CSRF, response loss, and concurrent races pass
  end-to-end tests;
- the accepted response-loss behavior explains that grace cannot reconstruct a
  lost replacement token and safely returns the user to reauthentication;
- a least-privilege scheduler repeatedly calls bounded cleanup with a maximum
  batch/time budget, a fresh correlation UUID per invocation/batch, overlap
  tests, monitoring, and no raw row export; retrying the same UUID provides
  correlation only and never deduplication; and
- dual-cookie precedence, downgrade prevention, rollback compatibility, drain,
  and legacy-cookie retirement are explicitly staged. An invalid/revoked new
  token cannot silently fall back to the legacy credential.

Cloudflare edge rate limiting is recommended defense in depth for the login
endpoint, but it does not replace the database's exact account/network
contract. Cloudflare documents that `CF-Connecting-IP` is added on edge-to-origin
traffic. Its rate-limiting parameter guide separately recommends combining the
IP-with-NAT-support characteristic with another characteristic such as path or
header value for security-critical endpoints. The deployment must prove its own
origin isolation and trusted-header path; this runbook does not equate that edge
characteristic with the database network fingerprint.

- `SESSION-RUN-019`: Phase 2B.3 MUST have separate architecture, application,
  database-security, browser, Cloudflare-ingress, and rollback approval. A
  successful inert migration is only a prerequisite, not cutover approval.

## Operational references

- [ADR 0004](../adr/0004-revocable-session-foundations.md) is the normative
  application-session contract.
- [NIST SP 800-63B-4 Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
  defines normative session-secret, protected transport, timeout, logout, and
  cookie expectations.
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
  [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
  and [Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
  inform randomness, expiry/rotation, throttling, and evidence privacy.
- [RFC 9700 section 4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2)
  informs the rotation-lineage/reuse-detection analogy; an application session
  is not claimed to be an OAuth refresh token.
- [W3C Web Cryptography `getRandomValues`](https://www.w3.org/TR/webcrypto-2/#Crypto-method-getRandomValues)
  is the secure runtime random source used by the token codec.
- Cloudflare's [request-header reference](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
  and [rate-limiting parameter guidance](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)
  define the external ingress facts and the security-critical multi-characteristic
  recommendation used by the Phase 2B.3 gate.
- PostgreSQL's [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html),
  [`SELECT ... SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html),
  [RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), and
  [`SECURITY DEFINER` guidance](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
  support the concurrency, cleanup, and ACL checks.

The external sources do not mandate this repository's precise token prefix,
digest context, timeouts, throttle thresholds, retention, cleanup limit, schema,
RPC signatures, or rollout order. Those values are repository decisions frozen
by ADR 0004 and verified by this runbook.
