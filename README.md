# cs2cup

Esports club site for Ningbo Institute of Technology, Zhejiang University. Registration, rosters, brackets, match reports with ban/pick, archive, admin.

Next.js App Router · React · TypeScript · CloudBase PostgreSQL · Cloud Run

## Develop

```bash
npm ci
npx playwright install chromium
npm run stack:up
npm run stack:seed
cp .env.example .env.local
npm run dev
```

On Linux CI or a new workstation, install Chromium's system packages with
`npx playwright install --with-deps chromium` instead.

`stack:up` is the one-command path for a fresh local database. If a local
database was created by this project before the migration ledger existed,
start only PostgreSQL, compare a schema-only dump with the reviewed main/012
reference, and adopt it once before continuing:

```bash
docker compose up -d db --wait
npm run stack:adopt
npm run stack:up
```

The adoption command checks release markers, expected objects, row-level
security and critical privileges under table locks before writing checksums for
migrations 001–012. It rejects known partial, insecure and newer states and
never replays seed-bearing historical migrations; it does not replace the
operator's reviewed schema diff or verified backup.

The local stack binds PostgreSQL and both PostgREST endpoints to `127.0.0.1`
only. Port 53000 serves public requests as `anon`; port 53001 serves trusted
server-side requests as the non-superuser `club_admin` role. Never expose the
admin endpoint outside the local machine. Point `RDB_BASE_URL` and
`RDB_ADMIN_BASE_URL` at the respective endpoints.

For the console, mint a local session:

```bash
node scripts/dev-session.mjs        # prints a token, serves JWKS on :53100
```

Set `CLOUDBASE_ISSUER=http://localhost:53100` and `CLOUDBASE_ENV_ID=dev-env`,
insert the subject into `admin_user`, then set the token as the
`cs2cup_session` cookie.

| Script | |
|---|---|
| `stack:up` | Starts local PostgreSQL, applies expand and contract migrations, configures authenticators, then starts PostgREST |
| `stack:migrate` | Applies immutable expand migrations through the checksum ledger |
| `stack:adopt` | Verifies and records an existing, unledgered main/012 schema once |
| `stack:contract` | Applies post-deploy contract migrations after old instances drain |
| `stack:seed` | Demo fixtures, local only |
| `stack:down` | Destroys the local stack and its database volume |
| `photos:import` | Decodes legacy base64 photos into the private photo root and emits SQL separately |
| `typecheck` `lint` `build` | Pipeline gates |
| `test:security-boundaries` | Public/private data and local-role regressions |
| `test:registration-fingerprint` | Trusted-address normalization and HMAC unit tests |
| `test:photo-storage-security` | Local object path containment and authoritative photo-delete regressions |
| `test:pack-standalone` | Proves deployment bundles contain public assets but never `.env*` or private `public/photos` files |
| `test:object-cleanup` | Proves database-first deletion and best-effort private-object cleanup |
| `test:rdb-endpoint` | Proves override URLs cannot receive CloudBase bearer credentials |
| `test:cache-boundaries` | Proves public revalidation, high-cardinality no-store, private transport no-store, allowlists and canonical protected-response directives |
| `test:session-token` | Canonical opaque-token generation, parsing, digest vectors and fail-closed Web Crypto regressions |
| `test:session-store` | Proves session RPC shapes, the 5-second default/30-second maximum deadline, strict RFC 3339-style response parsing and full transport-error remapping |
| `test:auth-boundaries` | Captures all sensitive authentication unit tests, scans normal and deliberately failed stdout/stderr, and emits diagnostics only after credential/identity canary checks |
| `test:cloudbase-environment` | Proves credentials can reach only a validated official CloudBase gateway origin |
| `test:registration-rate-limit` | Sequential and concurrent atomic rate-limit tests |
| `test:identity-foundations` | Private identity schema, constraints, claims boundary, audit immutability and concurrent resolver regressions |
| `test:session-foundations` | Revocable-session lifecycle, privacy, rollback, lock-order and concurrent cleanup regressions |
| `test:migrations` | Fresh install, legacy adoption, tamper, expand/contract, rollback and direct-`psql` lifecycle checks |
| `smoke:cloudbase` | Staging-only HTTPS proof for CloudBase RPC claims and expand/contract state; requires explicit acknowledgement and secret-store credentials |
| `a11y` | axe across 15 pages, zero violations expected |
| `keyboard` | Focus order, skip link, dialog and drawer |
| `perf` | Transfer, JS, image, font, LCP and CLS against a budget |
| `check` | Aggregate local gate for a caller-managed current production server; it does not build or start that server, and CI remains authoritative |
| `e2e` | Public browser regression suite |
| `e2e:admin` | Isolated production console E2E harness; requires one completed `stack:up` and the Compose database |
| `e2e:admin:run` | Low-level destructive runner; harness use or debugging only |
| `serve` | Build, pack the standalone bundle, run it |

For a server that is not running on port 3000, set `E2E_BASE_URL` before `npm run e2e`.
For example, in PowerShell: `$env:E2E_BASE_URL = 'http://127.0.0.1:3100'; npm run e2e`.

The admin suite rewrites bracket, schedule and content fixtures. `npm run
e2e:admin` is therefore an isolation harness rather than a direct test command.
After `npm run stack:up` has configured the shared local roles and with its
Compose `db` service still running, one command creates a uniquely named
`cs2cup_e2e_*` database, applies expand and contract migrations plus seeds,
starts loopback-only PostgREST and OIDC services, builds and starts an isolated
production standalone Next.js instance on a free port, provisions the admin
allowlist, runs the browser suite, then removes every resource it owns:

```bash
npm run e2e:admin
```

The harness fails before creating anything if those project-level roles are
missing; it never creates them or rewrites their credentials. It uses a
separate photo root and temporary application build context;
it never resets the shared `cs2cup` database or reuses the normal PostgREST and
Next ports. Its `finally` cleanup stops only the exact processes and containers
it created, force-drops only its generated database, and removes only its own
temporary directory. The project-level database service and shared local roles
remain available for other contributors.

`e2e:admin:run` remains available for harness development. It requires a
database named `cs2cup_e2e` (or `cs2cup_e2e_*`), `E2E_DB_OWNED=1`, a dev token,
and an already configured application. The runner still verifies
`current_database()` and unique public/admin-only probes before its first
application write. `E2E_RDB_BASE_URL` applies only to the non-admin public E2E
suite.

### Visual preview without data

For homepage visual adjustments without CloudBase or the local database, build and run the production container with the preview flag:

```powershell
docker build --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3100 -t cs2cup-local .
docker run --rm --name cs2cup-local -p 3100:3000 -e HOME_PREVIEW_COUNTDOWN=1 cs2cup-local
```

Open `http://localhost:3100`. The flag uses static fallbacks and displays the homepage countdown card as an unscheduled local preview. Do not set it in Cloud Run.

## Environment

| Variable | |
|---|---|
| `CLOUDBASE_ENV_ID` | CloudBase environment |
| `CLOUDBASE_ANON_KEY` | Publishable key, public reads |
| `CLOUDBASE_ADMIN_KEY` | Privileged key, admin writes |
| `CLOUDBASE_REGION` | Defaults to `ap-shanghai` |
| `CLOUDBASE_SMOKE_EXPECT_ENV_ID` | Independently injected exact staging target for the managed-gateway smoke only |
| `RDB_BASE_URL` | Overrides the read endpoint, local only |
| `RDB_ADMIN_BASE_URL` | Overrides the write endpoint, local only |
| `CLOUDBASE_ISSUER` | Overrides the OIDC issuer, local only |
| `NEXT_PUBLIC_SITE_URL` | Absolute HTTP(S) origin for sitemap, feed and cards; build-time input for production images, local default `http://localhost:3000` |
| `PHOTO_UPLOAD_DRIVER` | `local` or `cloudbase`; defaults to `local` |
| `PHOTO_LOCAL_ROOT` | Absolute private path for local photo objects; an empty value uses the operating-system temporary directory |
| `PHOTO_BUCKET` | CloudBase PG Storage bucket; defaults to `cs2cup-photos` |
| `REGISTRATION_FINGERPRINT_SECRET` | Dedicated secret of at least 32 bytes used to HMAC client addresses; required outside development |
| `REGISTRATION_CLIENT_IP_SOURCE` | Required outside development: ingress-owned `x-real-ip` or `cf-connecting-ip` |

## Layout

| Path | |
|---|---|
| `app/(public)/` | Public routes |
| `app/(public)/tournaments/[slug]/` | Overview, teams, bracket, results, rules, register |
| `app/admin/` | Console |
| `components/ui/` | Primitives, no domain imports |
| `components/domain/` | Tournament components |
| `components/layout/` | Shells and navigation |
| `lib/` | Data access, auth, bracket resolution |
| `app/feed.xml/` | RSS |
| `app/media/[...key]/` | Serves local uploads |
| `migrations/` | Immutable expand migrations tracked by SHA-256 checksum |
| `migrations/post-deploy/` | Contract migrations run only after old instances drain |
| `migrations/rollback/` | Coordinated operational rollback scripts |
| `seeds/` | Demo data, never production |
| `scripts/` | Migration tools, browser tests, dev session |

`components/ui/` must not import `lib/types.ts`.

See [migration authoring and operations](docs/migrations.md) before adding or
running a database change.

Body text and heavy Chinese headings use the platform CJK stack. Big Shoulders
and JetBrains Mono are versioned OFL variable-font dependencies restricted to
their Latin subsets (about 75 KB of source WOFF2 combined), so production
builds never download fonts from an external service. Their copyright and
OFL-1.1 terms ship with every standalone artifact; see
[third-party notices](THIRD_PARTY_NOTICES.md).

## Data

| Table | |
|---|---|
| `site_setting` | Single row |
| `tournament` | Edition, game, format, status |
| `team` | Holds `contact`, revoked from `anon` |
| `player` | Roster entries |
| `match` | Round, slot, scores, self-referencing sources |
| `match_map` | Ordered ban/pick, skipped maps retained |
| `photo` | Object storage keys |
| `club_member` `post` | Club content |
| `admin_user` | Allowlist |
| `registration_attempt` | Rate-limit ledger, hashed fingerprints |
| `app_private.principal` `principal_identity` `principal_profile` | Provider-neutral subjects, private external identity bindings and private-by-default profiles |
| `app_private.role_assignment` `team_ownership` | Revocable application-role and tournament-entry relationships; not yet an authorization source |
| `app_private.audit_event` | Append-only, data-minimized application audit envelope |
| `app_private.app_session` `app_session_token` | Revocable, hash-only application-session families and token lineage; inert until the reviewed cookie cutover |
| `app_private.login_throttle` | Keyed account/network login-admission counters; inert until the reviewed authentication cutover |

Public reads use `team_public`, `player_public`, `match_map_public` and
`photo_public`. These views exclude records attached to draft tournaments;
`team_public` also omits `contact` and `note`. Base-table RLS enforces the same
tournament boundary for matches, match maps and photos. Posts remain private
until `published_at`.

Repository reads use explicit cache capabilities: reviewed anonymous
projections choose either bounded revalidation or no-store, while private
reads, every mutation and every privileged RPC are unconditionally no-store.
All identity-, data- or application-state-dependent responses under
`/admin/**`, `/media/**` and `/photos/**`—including authentication redirects
and application errors—send the same private no-store policy. Next.js's
bodyless, identity-independent trailing-slash 308 is the documented exception.
See
[ADR 0003](docs/adr/0003-explicit-cache-boundaries.md) for the agent-readable
data classification, response rules, tests and Cloudflare constraints.

Migration 018 adds identity foundations without changing current product
authority. Existing rows are not backfilled: `admin_user.user_id` remains the
administrator allowlist, anonymous registration behaves as before, and stored
roles or ownership rows grant no capability until a later reviewed cutover.
See [ADR 0002](docs/adr/0002-domain-identity-foundations.md) and the
[identity-foundations rollout runbook](docs/runbooks/identity-foundations-rollout.md)
for the exact namespace, privacy, authorization and deployment contract.

Migration 019 adds revocable application-session, rotation/replay detection,
dual-dimension login-throttle and bounded-cleanup foundations without changing
the current login, logout, `cs2cup_session` cookie or administrator authority.
It persists only fixed-size digests and keyed fingerprints; production rows
remain empty until the separately reviewed authentication cutover. See
[ADR 0004](docs/adr/0004-revocable-session-foundations.md) and the
[session-foundations rollout runbook](docs/runbooks/revocable-session-foundations-rollout.md)
for the exact state machine, lock order, privacy rules and release gates.

Migration 020 atomically binds a verified administrator identity to its stable
Principal and admits at most five live application-session families. The new
provider-proof, fingerprint, session, cookie and CSRF adapters remain unwired;
an absent or exact `SESSION_AUTH_MODE=legacy` preserves the current login and
cookie behavior. See [ADR 0005](docs/adr/0005-application-session-cutover.md)
and the [application-session cutover runbook](docs/runbooks/application-session-cutover.md)
for the staged wiring, Cloudflare evidence, drain, rollback and retirement
contract.

The inert 2B.3a session adapter gives every RPC a 5-second default deadline,
accepts only an integer override through 30 seconds, replaces every transport
or timeout failure with a fresh fixed error, validates session timestamps as
calendar-valid RFC 3339-style values, and accepts login retry responses only
within `0..900` seconds with consistent allow/deny semantics. Its CI redaction
gate is the sole CI runner for the sensitive token, provider, session, cookie,
fingerprint and CSRF unit scripts. It captures naturally green/failing runs,
deliberately triggers redaction-path `AssertionError` failures, and rejects
combined stdout/stderr containing provider password/access-token/issuer/subject,
application-session token/digest/UUID/cookie, login fingerprint/IP, or CSRF
canaries. A child failure emits only the fixed gate error and never replays raw
child stdout/stderr. The migration 020 SQL suite
also proves that missing, malformed, `anon`,
`authenticated`, and `club_admin` claims cannot pass the in-body
`service_role` guard. These are unwired adapter and disposable-database facts,
not 2B.3b request-path or browser evidence.

The server action derives an HMAC fingerprint from the trusted client address,
and the database checks, records and executes each attempt in one atomic
transaction. IPv6 privacy addresses share a `/64` quota, and raw addresses are
never stored. Development uses a process-local random key and loopback address
when ingress headers are absent. Production instead fails closed unless the
dedicated key and an explicit trusted ingress source are available.

Privileged implementations live in the non-exposed `app_private` schema as
`SECURITY INVOKER` routines. Public PostgREST wrappers validate the signed
gateway `request.jwt.claims.role` inside the function body before delegating;
this is required because CloudBase documents that its RPC gateway does not
enforce PostgreSQL function `EXECUTE` grants. Contract migrations remove the
legacy registration wrappers entirely. `CLOUDBASE_ADMIN_KEY` maps to the highly
privileged `service_role`; it must remain server-side even with these guards.

Generate a production secret with a cryptographically secure password manager
or `openssl rand -base64 32`. Configure only an address header that the trusted
ingress overwrites; never trust a client-supplied forwarding header. Use
`cf-connecting-ip` only when the origin accepts traffic exclusively from
Cloudflare.

After applying the migrations, verify the security boundaries independently:

```bash
npm run test:security-boundaries
npm run test:identity-foundations
npm run test:session-foundations
npm run test:auth-boundaries
npm run test:application-session-admission
npm run test:registration-fingerprint
npm run test:registration-rate-limit
```

## Deploy

Build the image from the `Dockerfile` with an explicit public origin, then run
it on CloudBase Cloud Run, port 3000:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SITE_URL=https://your-production-origin.example \
  --tag cs2cup:release \
  .
```

The build rejects a missing, relative or non-HTTP(S) origin. Next.js embeds
this public value into canonical metadata, RSS, robots and sitemap output, so a
Cloud Run runtime variable cannot repair an image built with the wrong origin;
rebuild and promote a new image instead.

Database-backed game, post and tournament slugs are resolved with dynamic
server rendering. Image builds do not enumerate or snapshot deployment data,
which keeps artifacts reproducible and independent of database availability.

Use a PostgreSQL client compatible with the target database and inject
`MIGRATION_DATABASE_URL` plus the independently configured
`MIGRATION_EXPECT_DATABASE` from the deployment secret store. The runner parses
the URL into `PG*` variables so credentials are not passed in process arguments,
clears inherited libpq overrides, confirms `current_database()`, and records
every normalized SQL checksum. Before touching production, take and verify a
restorable backup, use the provider-required TLS configuration, and use a
dedicated least-privilege migration identity rather than an application key or
personal account.

There is one canonical production migration path:

1. On an existing production database that has no ledger, first review a
   schema-only diff against main/012; if it passes the documented compatibility
   gate, run `npm run stack:adopt` once. On a fresh database, skip adoption.
2. Run `npm run stack:migrate` to apply expand migrations.
3. Deploy a canary, verify it, shift traffic, then wait for old instances and
   in-flight requests to drain.
4. Run `npm run stack:contract` and repeat the local checks plus the
   staging-only managed-gateway smoke in contracted mode.

Do not mix the repository runner with per-file SQL editor execution or a
provider-managed migration ledger. An applied migration is immutable; add a
new numbered migration instead of editing it. See the
[registration rollout runbook](docs/runbooks/registration-rate-limit-rollout.md)
for its canary, contract and coordinated rollback procedure, and the
[identity-foundations rollout runbook](docs/runbooks/identity-foundations-rollout.md)
before applying migration 018. CloudBase
connection setup is documented in its
[direct PostgreSQL guide](https://docs.cloudbase.net/database/postgresql/connecting-to-postgresql),
and its gateway behavior in the
[RPC guide](https://docs.cloudbase.net/database/postgresql/rpc).

`npm run smoke:cloudbase` is deliberately outside the default local/CI gate. It
requires `CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING=1`, an explicit expanded or
contracted phase, and an independently injected `CLOUDBASE_SMOKE_EXPECT_ENV_ID`
that exactly matches the validated target before either key is read or any
request is sent. It calls the real CloudBase HTTPS gateway and creates one
failed random-fingerprint attempt. The row becomes eligible for opportunistic
deletion after 24 hours on the next guarded submission; there is no wall-clock
upper bound until a scheduled cleanup job is deployed. It must never target
production.

For persistent photos, set `PHOTO_UPLOAD_DRIVER=cloudbase` and
`PHOTO_BUCKET=cs2cup-photos`. The server-only environment ID and admin key
authorize the private bucket; browsers read published photos only through the
authorization-aware `/media/...` route. Legacy import writes object files to
`PHOTO_LOCAL_ROOT`, never `public/photos`; upload those objects to the private
bucket as a separate, audited deployment step.
