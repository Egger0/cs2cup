# Database migrations

PostgreSQL is the system of record. Application traffic reaches it through
Cloudflare Hyperdrive; migrations and administrator credential provisioning
always use a separate direct TLS PostgreSQL connection. Hyperdrive does not
support migration advisory locks or arbitrary session state, and its private
runtime login must not own schema or credential-provisioning privileges.

## Rules

- Applied files are immutable. Add a higher three-digit version instead of
  editing, renaming, or deleting an applied migration.
- Expand files live in `migrations/`; matching post-deploy contraction files
  live in `migrations/post-deploy/`.
- The runner verifies normalized SHA-256 checksums and rejects gaps inserted
  behind an already-applied version.
- Back up and restore-test production before a schema change.
- Never run migrations or `admin:credential` with the Hyperdrive runtime login
  or through the Hyperdrive endpoint.
- Never put a database password, administrator password, or
  `ADMIN_AUTH_PEPPER` in this repository, a command argument, Wrangler
  configuration, build output, or logs.

## Local flow

```bash
npm run stack:up
npm run stack:seed
npm run test:migrations
```

`stack:up` starts only PostgreSQL, applies expand migrations, then applies the
post-deploy contractions. A pre-ledger database at the verified migration-012
shape can be adopted once with `npm run stack:adopt`.

Migration 022 creates no default password. After the migration, provision a
local administrator with the guarded `admin:credential --password-stdin` flow
documented in the [Cloudflare release checklist](cloudflare-release.md).

## Target database flow

Inject the migration-owner direct URL from the target secret store, then set
the exact non-secret database-name guard:

```bash
export MIGRATION_EXPECT_DATABASE='exact_database_name'
npm run stack:migrate
```

`MIGRATION_DATABASE_URL` must already be present in the environment without
having been placed in shell history. The runner parses it into a closed set of
libpq environment variables, verifies `current_database()`, and runs each
migration and ledger write in one transaction.

After migration 022 succeeds, use that same direct migration-owner connection
to initialize or rotate each administrator. The command additionally requires
the exact `ADMIN_AUTH_PEPPER`, `ADMIN_CREDENTIAL_ALLOW_MUTATION=1`, and the
database-name guard; it reads the password only from standard input. It refuses
to run if migration 022 is absent. Provisioning creates or updates the salted
600,000-iteration PBKDF2-HMAC-SHA256 verifier and atomically revokes that
Principal's previous sessions.

After the new Worker has been deployed, verified, and all old instances have
drained:

```bash
npm run stack:contract
```

## Migration 021 and 022 history

Migration 021 is immutable history from an earlier Cloudflare Access cutover.
Its expand phase changed the application runtime to Hyperdrive-compatible row
locks. Its post-deploy contraction removed the then-obsolete, provider-oriented
public session and identity RPCs while retaining private historical rows for
audit and rollback evidence.

The application no longer depends on Cloudflare Access. Migration 022 restores
application-owned administrator authentication without editing or resurrecting
the old RPC contract. It adds `app_private.local_admin_credential` and activates
four newly named trusted-service wrappers:

- `public.begin_local_admin_login(bytea, bytea, text)`;
- `public.create_local_admin_session(uuid, bigint, bytea, bytea, uuid)`;
- `public.use_local_admin_session(bytea, uuid)`;
- `public.end_local_admin_session(bytea, uuid)`.

On a fresh database, post-deploy contractions are still applied in version
order, so the historical 021 contraction runs before the 022 post-deploy
contract. `022_activate_local_admin_sessions.sql` then verifies and reasserts
that the new credential table and newly named RPC boundary are current. The
correct fix for any future change is migration 023 or later, never an edit to
021 or 022.

## Runtime database contract

The Hyperdrive origin login is a private PostgreSQL credential that inherits
`club_admin` and no broader role. Provision it out of band. Do not grant it
superuser, database creation, role creation, replication, or RLS bypass. It has
no direct access to `app_private` credential, session, throttle, or audit
tables; the newly named `public.*` `SECURITY DEFINER` wrappers are its only
administrator-authentication path.

Migration 021 also preserves atomic registration, seeding, bracket, score,
report, and schedule operations under Hyperdrive by replacing runtime advisory
locks with fixed transaction-scoped row-lock stripes. Migration 022 reuses the
provider-neutral Principal, revocable-session, audit, and atomic two-dimension
login-throttle foundations from migrations 018 and 019. Password derivation
stays in the trusted Worker/provisioning process; PostgreSQL stores only the
salted verifier and never the pepper, raw password, or raw 256-bit session
token. The active login wrapper uses one network-before-account lock order,
skips account-row creation after network blocking, performs bounded private
24-hour cleanup, and makes session admission idempotent by token digest.

Verify the current contract with:

```bash
npm run test:admin-auth
npm run test:migrations
npm run test:hyperdrive-runtime
npm run test:local-admin-auth
npm run test:local-admin-auth-concurrency
npm run test:match-operations
npm run test:match-schedule
npm run test:registration-rate-limit
```

Schema rollback does not reverse these files. Roll application traffic first,
preserve the migration ledger and audit rows, and recover with a forward
migration or the restore-tested backup according to the release checklist.
