# Migration authoring and operations

Database history is a public compatibility surface. Treat it with the same
review discipline as an API: immutable after application, append-only, tested
on both a fresh database and the oldest supported upgrade path.

## Authoring rules

- Name files `NNN_lower_snake_case.sql`. A version is unique within each phase.
- Put backward-compatible changes in `migrations/`. Put destructive cleanup in
  `migrations/post-deploy/` at the same version as its required expand file.
- Choose a number greater than every applied version in that phase. Never fill
  a historical gap, rename an applied file, or edit its contents; normalized
  SHA-256 checksums are part of the ledger contract.
- Do not add `BEGIN`, `COMMIT`, psql meta-commands, environment-specific data or
  application secrets. The runner owns one transaction per file.
- Keep expand SQL compatible with both the old and new application. Contract
  only after the new image is healthy, traffic has shifted, old instances have
  drained, and the release runbook's evidence is recorded.
- Use schema-qualified names and fixed `search_path` values. A gateway-exposed
  `SECURITY DEFINER` routine must authorize from signed claims in its body and
  delegate to a least-privilege private implementation.
- Add a coordinated rollback only when application rollback requires it. The
  rollback must own one transaction, acquire advisory lock
  `(1129521731, 1296647246)`, and change only ledger rows it explicitly owns.

## Required verification

Update `scripts/migration-lifecycle-test.mjs` with a failure injection for the
new invariant, then run:

```bash
npm run test:migration-checksum
npm run test:migration-state
npm run test:migrations
```

The lifecycle suite covers fresh install, explicit legacy adoption, checksum
tampering, missing history, expand/contract dependencies, coordinated rollback,
concurrent runners and direct `psql`. `MIGRATION_TEST_MAX_VERSION` exists only
for that suite; the runner rejects it unless `MIGRATION_ENABLE_TEST_CONTROLS=1`
and refuses it entirely under `NODE_ENV=production`.

Migration-specific evidence belongs with its reviewed rollout procedure. For
the additive identity foundation in migration 018, follow the
[identity-foundations rollout runbook](runbooks/identity-foundations-rollout.md)
and run `npm run test:identity-foundations` in addition to the lifecycle suite.
That migration deliberately has no destructive contract or down migration;
application rollback leaves its unused private tables and nullable bridges in
place, while a schema defect is repaired by a new forward migration.

## Release operation

Use one reviewed checkout and one dedicated least-privilege migration identity.
Take and verify a restorable backup, inject the direct PostgreSQL URL from the
secret store, configure provider-required TLS, and set the expected database
name independently. The runner clears inherited libpq overrides, verifies the
actual database, serializes runners with a database advisory lock, validates
both phase histories, and applies each file atomically.

Legacy `--baseline 012` adoption is deliberately narrow but is not a complete
catalog fingerprint. The automated gate checks release markers, required
objects, RLS and critical privileges under table locks; it then records history
without replaying old seed migrations.

### Reproduce the main/012 schema comparison

Use a reviewed checkout, a clean working tree, and the same PostgreSQL 17
`pg_dump` build for both dumps. Record the checkout commit and `pg_dump
--version` in the release issue. First prove that the immutable baseline files
still match the reviewed main branch, then create a throwaway local reference:

```bash
set -euo pipefail
git fetch origin main
git diff --exit-code origin/main -- migrations/00[1-9]_*.sql migrations/01[0-2]_*.sql

reference_database=cs2cup_main_012_reference
migration_audit_dir="$(mktemp -d)"
chmod 700 "$migration_audit_dir"
docker compose up -d db --wait
docker compose exec -T db createdb -U postgres "$reference_database"
MIGRATION_DB_NAME="$reference_database" \
  MIGRATION_ENABLE_TEST_CONTROLS=1 \
  MIGRATION_TEST_MAX_VERSION=012 \
  node scripts/migrate.mjs
docker compose exec -T db pg_dump \
  -U postgres \
  -d "$reference_database" \
  --schema-only \
  --schema=public \
  --exclude-table=public.schema_migration \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  > "$migration_audit_dir/reference.raw.sql"
```

Inject the legacy target's `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE` and required `PGSSL*` variables from the release secret store.
Do not put a connection URL or password in command arguments. Use the same
pinned client as the reference; the following forwards variable names, not
their values, to that client:

```bash
docker compose exec -T \
  -e PGHOST \
  -e PGPORT \
  -e PGUSER \
  -e PGPASSWORD \
  -e PGDATABASE \
  -e PGSSLMODE \
  db pg_dump \
  --schema-only \
  --schema=public \
  --exclude-table=public.schema_migration \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  > "$migration_audit_dir/target.raw.sql"
```

If the provider requires client certificate files, mount only those approved
files read-only into the pinned client and forward the corresponding `PGSSL*`
paths. Normalize only `pg_dump`'s volatile header tokens, then preserve and
review the complete unified diff:

```bash
normalize_schema_dump() {
  sed -E \
    -e '/^[\\](un)?restrict /d' \
    -e '/^-- Dumped from database version /d' \
    -e '/^-- Dumped by pg_dump version /d'
}

normalize_schema_dump \
  < "$migration_audit_dir/reference.raw.sql" \
  > "$migration_audit_dir/reference.sql"
normalize_schema_dump \
  < "$migration_audit_dir/target.raw.sql" \
  > "$migration_audit_dir/target.sql"
diff_status=0
diff -u \
  "$migration_audit_dir/reference.sql" \
  "$migration_audit_dir/target.sql" \
  > "$migration_audit_dir/schema.diff" || diff_status=$?
docker compose exec -T db dropdb -U postgres "$reference_database"
if (( diff_status > 1 )); then
  printf 'schema comparison failed; inspect the dump artifacts\n' >&2
  exit "$diff_status"
fi
if (( diff_status == 1 )); then
  printf 'schema differences require independent review before adoption\n' >&2
  exit 1
fi
```

Attach the two normalized dumps, the diff, commit, client version, reviewer and
backup identifier to the restricted release record. Explain every difference;
do not adopt when a difference is unreviewed or changes the expected
application schema. The dump intentionally omits ownership and ACLs because
managed roles differ; the adoption gate remains responsible for its explicit
RLS and critical-privilege checks.
