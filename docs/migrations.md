# Database migrations

PostgreSQL is the system of record. Application traffic reaches it through
Cloudflare Hyperdrive; migrations always use a direct TLS PostgreSQL connection
because Hyperdrive does not support migration advisory locks or arbitrary
session state.

## Rules

- Applied files are immutable. Add a higher three-digit version instead of
  editing, renaming, or deleting an applied migration.
- Expand files live in `migrations/`; matching post-deploy contraction files
  live in `migrations/post-deploy/`.
- The runner verifies normalized SHA-256 checksums and rejects gaps inserted
  behind an already-applied version.
- Back up and restore-test production before a schema change.
- Never run application migrations with the Hyperdrive login or through the
  Hyperdrive endpoint.
- Never put a database password in this repository, a command argument, or a
  Wrangler configuration file.

## Local flow

```bash
npm run stack:up
npm run stack:seed
npm run test:migrations
```

`stack:up` starts only PostgreSQL, applies expand migrations, then applies the
post-deploy contractions. A pre-ledger database at the verified migration 012
shape can be adopted once with `npm run stack:adopt`.

## Target database flow

Inject these values from the target secret store:

```bash
export MIGRATION_DATABASE_URL='postgresql://...'
export MIGRATION_EXPECT_DATABASE='exact_database_name'
npm run stack:migrate
```

After the new Worker has been deployed, verified, and all old instances have
drained:

```bash
npm run stack:contract
```

The runner parses `MIGRATION_DATABASE_URL` into a closed set of libpq
environment variables, verifies `current_database()`, and runs each migration
and ledger write in one transaction.

## Cloudflare runtime contract

Migration 021 replaces runtime advisory locks with fixed row-lock stripes.
This preserves atomic registration, seeding, bracket, score, report, and
schedule operations on Hyperdrive. It also lets a dedicated PostgreSQL login
inherit the existing least-privilege `club_admin` role and pass the trusted
`public.*` RPC boundary without PostgREST JWT session state.

Provision the login and its password out of band. Do not grant it superuser,
database creation, role creation, replication, or RLS bypass. The 021
post-deploy contraction disables obsolete application-session RPCs while
retaining historical private rows for audit and rollback safety.

Verify the current contract with:

```bash
npm run test:hyperdrive-runtime
npm run test:match-operations
npm run test:match-schedule
npm run test:registration-rate-limit
```
