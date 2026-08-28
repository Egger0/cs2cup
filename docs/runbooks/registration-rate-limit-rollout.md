# Registration guard rollout and rollback

This runbook deploys the registration boundary introduced by expand migrations
014 and 017 and contract migrations 014 and 017. Rehearse the complete sequence
in staging. Record the operator, reviewed commit, migration checksums, image
digest, target database, backup identifier, start time, verification evidence
and rollback decision in the release issue.

## Production prerequisites

Configure the application before shifting traffic:

- `REGISTRATION_FINGERPRINT_SECRET`: a dedicated random secret containing at
  least 32 bytes. Do not reuse a database, session or API credential.
- `REGISTRATION_CLIENT_IP_SOURCE=cf-connecting-ip` only when Cloudflare is the
  exclusive origin path and overwrites that header.
- `REGISTRATION_CLIENT_IP_SOURCE=x-real-ip` only behind an ingress that removes
  the incoming value and writes a verified client address.

CloudBase is not assumed to provide a request-scoped client address directly to
this long-running Next.js process. Prove the chosen header and origin isolation
with a staging route before enabling registration. Also enable the HTTP access
service's per-client-IP QPS control as defense in depth. If either property
cannot be demonstrated, leave registration fail-closed and deploy a verified
ingress adapter or the account-based registration phase first.

Generate the HMAC secret with a managed secret store or `openssl rand -base64
32`. Never print it in a shell transcript, issue, pull request or CI log.

Use the repository migration runner as the only production migration system.
Install `psql`, take and verify a restorable backup, and obtain direct PostgreSQL
connection details from the CloudBase console. Use a dedicated migration
identity with only the DDL and `schema_migration` access required for this
release; do not reuse an application admin key or long-lived business account.
Configure the console-provided TLS mode and certificates. Inject
`MIGRATION_DATABASE_URL` and the independently configured
`MIGRATION_EXPECT_DATABASE` from the release secret store. Do not pass a URL
containing credentials as a command-line argument, and do not mix this ledger
with manual per-file SQL editor execution or a provider migration manager.

References:

- [CloudBase direct PostgreSQL connection](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql)
- [CloudBase RPC gateway behavior](https://docs.cloudbase.net/database/postgresql/rpc)
- [CloudBase HTTP ingress and traffic controls](https://cloud.tencent.com/document/product/876/34822)

## Pre-deploy verification

1. If this is the existing, unledgered main/012 database, first complete the
   [reproducible schema comparison](../migrations.md#reproduce-the-main012-schema-comparison),
   record its independent review, then run `npm run stack:adopt` once. Its
   catalog gate rejects known partial, insecure and newer markers but is not a
   complete schema fingerprint. Never baseline a database merely to bypass an
   error.
2. Run `npm run stack:migrate` in staging. The runner must confirm
   `current_database()`, acquire the database migration lock, verify both
   phase histories are unique and append-only, and apply through
   `017_cloudbase_rpc_guards.sql`.
3. Confirm privileged implementations are `SECURITY INVOKER` routines in
   `app_private`; `anon`, `authenticated`, `club_admin` and `service_role` have
   no direct access to that schema.
4. Deliberately expose public wrapper execution to a test authenticator. Prove
   empty, malformed, `anon` and `authenticated` claims receive SQLSTATE 42501,
   while signed `service_role` claims reach the guarded business path.
5. Configure the registration secret and trusted source, then submit one
   deliberately invalid staging registration through the browser. Confirm the
   newest fingerprint matches `^v1:[0-9a-f]{64}$` and contains no raw address.
6. Run `npm run test:security-boundaries`, `npm run
   test:registration-fingerprint`, `npm run test:registration-rate-limit` and
   `npm run test:migrations`. These are local/CI regression checks against the
   repository's PostgreSQL and PostgREST configuration; they are not evidence
   that the managed CloudBase gateway enforces the same boundary.
7. Inject the staging-only CloudBase keys from the release secret store. From a
   separately reviewed release parameter, inject the exact staging environment
   as `CLOUDBASE_SMOKE_EXPECT_ENV_ID`; do not derive it from
   `CLOUDBASE_ENV_ID`. Set `CLOUDBASE_SMOKE_PHASE=expanded` and explicitly
   acknowledge the operation:

   ```bash
   export CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING=1
   export CLOUDBASE_SMOKE_EXPECT_ENV_ID=the-independently-approved-staging-id
   export CLOUDBASE_SMOKE_PHASE=expanded
   npm run smoke:cloudbase
   ```

   Do not place either key in a command, transcript or committed environment
   file. The smoke calls the real HTTPS RPC gateway with both identities and
   writes one deliberately failed attempt under a random fingerprint. It is
   eligible for opportunistic deletion after 24 hours when a later guarded
   submission runs, but has no hard retention ceiling until scheduled cleanup
   is deployed. Record that limitation and run it only against an approved
   disposable staging environment, never production.

Do not continue when the selected address header is absent, caller-controlled
or bypassable. Rejection is the intended failure mode.

## Forward rollout

1. **Expand:** run `npm run stack:migrate`. Do not contract yet. Both the new
   atomic wrapper and the claims-guarded legacy wrappers support the rolling
   window.
2. **Deploy:** release the reviewed image by immutable digest. Start with a
   staging environment or small canary.
3. **Verify:** exercise a disposable registration fixture, confirm expected
   attempt-ledger behavior and monitor authorization, submission and rate-limit
   errors.
4. **Shift and drain:** move traffic to the new image, route zero traffic to the
   old image, and wait for old instances and in-flight requests to finish.
5. **Contract:** run `npm run stack:contract`. Before any write, the runner
   validates every applied expand and contract checksum, then checks every
   pending contract file against its exact expand filename. Migration 014
   removes local compatibility access; migration 017 physically drops
   `public.submit_team(jsonb)` and
   `public.recent_registration_attempts(text,integer)`.
6. **Prove:** repeat the managed-gateway smoke with
   `CLOUDBASE_SMOKE_PHASE=contracted`. It requires both legacy endpoints to be
   absent for both identities while the guarded path remains usable. Observe
   the agreed post-release window.

Local `npm run stack:up` runs expand and contract in a maintenance window by
stopping both local PostgREST services first. A production rolling release must
keep the phases separate.

## Rollback

Before contraction, route traffic back to the previous image; the guarded
compatibility wrappers are still present.

After either contract migration has been applied, restore compatibility before
sending traffic to the old image:

1. Stop the rollout and prevent the old image from receiving traffic.
2. Configure `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` (or `.pgpass`),
   `PGDATABASE` and TLS variables from the secret store. Set the non-secret
   `MIGRATION_EXPECT_DATABASE` independently.
3. From the reviewed repository checkout, verify the exact target and execute
   the complete rollback file:

   ```bash
   set -euo pipefail
   : "${MIGRATION_EXPECT_DATABASE:?set the independently verified database name}"
   actual_database="$(psql -X -Atqc 'select current_database()')"
   if [[ "$actual_database" != "$MIGRATION_EXPECT_DATABASE" ]]; then
     printf 'refusing rollback: connected to unexpected database\n' >&2
     exit 1
   fi
   psql -X -v ON_ERROR_STOP=1 \
     -f migrations/rollback/017_restore_registration_compatibility.sql
   ```

4. Verify signed `service_role` claims can use both compatibility wrappers and
   `anon`/`authenticated`, empty, malformed and database-owner-without-claims
   calls are rejected. Repeat `npm run smoke:cloudbase` with
   `CLOUDBASE_SMOKE_PHASE=expanded` against staging to verify the restored
   managed-gateway behavior.
5. Deploy the previous image by its recorded digest and monitor registration.

The rollback file owns one transaction and is safe when only contract 014 was
applied: it uses `CREATE OR REPLACE`, restores local compatibility access, and
deletes only the 014 and 017 contract ledger rows that this rollout owns. It
does not remove expand migration 017, reopen `app_private`, or weaken the
in-body claims guard. Do not wrap it in another transaction, split it across a
SQL editor, or manually edit the ledger.

After the corrected forward image is healthy and every old instance drains,
run the normal `npm run stack:contract` command. The two deleted contract ledger
rows are reapplied; unrelated historical migrations are not replayed.

If the incident is limited to client-address configuration, prefer correcting
the ingress proof and rolling forward. Never substitute `x-forwarded-for` or
another client-controlled multi-hop value as an emergency workaround.
