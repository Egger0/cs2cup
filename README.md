# cs2cup

宁波理工电竞社赛事站：报名、战队、签表、赛程、战报、内容和后台管理。

The production stack is deliberately small:

- Next.js 16 + React 19 on Cloudflare Workers through OpenNext;
- Hyperdrive to the existing PostgreSQL database;
- a private R2 bucket for media;
- application-owned administrator credentials and revocable PostgreSQL
  sessions.

There is no Cloudflare Access or other Zero Trust runtime dependency, D1
application database, CloudBase SDK, or PostgREST transport. The Worker uses a
private PostgreSQL credential supplied by the target Hyperdrive configuration;
browser users never receive that credential.

## Local development

Requirements: Node.js 24, Docker, and Chromium for browser tests.

```bash
npm ci
npx playwright install chromium
cp .env.example .env.local
npm run stack:up
npm run stack:seed
npm run dev
```

`stack:up` starts only PostgreSQL on `127.0.0.1:55432`, applies immutable
expand migrations, and applies their post-deploy contractions. `DATABASE_URL`
is used by ordinary Next.js development and the isolated browser harness;
Cloudflare production always uses the `CS2CUP_DATABASE` Hyperdrive binding.

Set `ADMIN_AUTH_PEPPER` in `.env.local` to the unpadded base64url encoding of
exactly 32 random bytes. After migration 022 is applied, initialize a local
administrator with
`npm run admin:credential -- --username <name> --password-stdin`; the command
also requires the guarded direct-database
variables documented in the [release checklist](docs/cloudflare-release.md).
The same command rotates that username's password and revokes all of its
existing sessions.

The public site does not require an identity. `/admin/login` exercises the same
application-owned password and cookie flow locally and in production. Use
`npm run e2e:admin` for a fully isolated administrator flow.

## Commands

| Command | Purpose |
|---|---|
| `npm run stack:up` | Start PostgreSQL and apply expand + contract migrations |
| `npm run stack:seed` | Insert local demo fixtures |
| `npm run stack:migrate` | Apply append-only expand migrations |
| `npm run stack:contract` | Apply post-deploy contractions after old instances drain |
| `npm run stack:adopt` | One-time verified adoption of an unledgered migration-012 database |
| `npm run admin:credential -- --username <name> --password-stdin` | Initialize or rotate an administrator credential and revoke its old sessions |
| `npm run typecheck` / `lint` / `build` | Static and Next.js gates |
| `npm run cf:check` | OpenNext build plus compressed Worker size budget |
| `npm run test:cloudflare-worker` | Local Wrangler/OpenNext, Hyperdrive, and R2 runtime smoke |
| `npm run test:admin-auth` | Administrator password, pepper, token, and encoding boundaries |
| `npm run test:local-admin-auth` | Credential, throttle, idempotent session, cleanup, and database ACL boundaries |
| `npm run test:local-admin-auth-concurrency` | Concurrent account/network login admission boundaries |
| `npm run test:hyperdrive-runtime` | Direct-runtime role, RPC, row-lock, and session boundaries |
| `npm run test:r2-storage` | Private R2 object-store contract |
| `npm run test:registration-rate-limit` | Sequential and concurrent atomic registration limits |
| `npm run e2e` | Public browser suite against a running application |
| `npm run e2e:admin` | Isolated database, application-owned login, and admin browser suite |
| `npm run check` | Complete local quality gate |

`e2e:admin` owns every temporary resource it creates: a uniquely named
database, an application process, an object root, and a temporary build
context. It validates the database name before the first write and removes
only those exact resources in `finally` cleanup.

`test:cloudflare-worker` requires a current `cf:build` and a disposable,
seeded PostgreSQL database. Its local Hyperdrive URL must use a dedicated
`LOGIN INHERIT` role that has only `club_admin`; the smoke test rejects
superuser, role/database-creation, replication, RLS-bypass, and private
credential privileges. Set `CLOUDFLARE_WORKER_SMOKE_EXPECTED_DATABASE` to the
exact database name and `CLOUDFLARE_WORKER_SMOKE_ALLOW_DATABASE_MUTATION=1`.
To exercise login, provision the disposable credential first and supply all of
the smoke username, password, pepper, and `NEXT_PUBLIC_SITE_URL` variables.
The temporary photo fixture and local Wrangler/R2 state are removed on exit.
Never point this smoke test at production.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Direct PostgreSQL URL for local Next.js/standalone only |
| `ADMIN_AUTH_PEPPER` | Unpadded base64url encoding of exactly 32 random bytes; required by administrator password and throttle derivation |
| `NEXT_PUBLIC_SITE_URL` | Exact public HTTP(S) origin; production administrator cookies require HTTPS |
| `PHOTO_UPLOAD_DRIVER` | `local` in development, `r2` on Cloudflare |
| `PHOTO_LOCAL_ROOT` | Absolute private object root for local development |
| `REGISTRATION_FINGERPRINT_SECRET` | Dedicated secret, at least 32 bytes outside development |
| `REGISTRATION_CLIENT_IP_SOURCE` | Trusted ingress header: `x-real-ip` or `cf-connecting-ip` |
| `HOME_PREVIEW_COUNTDOWN` | `1` only for the explicit data-free visual preview |

Wrangler binds `CS2CUP_DATABASE` and `CS2CUP_MEDIA`; they are not process
environment variables. Never commit database URLs, passwords, pepper values,
API tokens, or R2 credentials.

## Runtime boundaries

- Public repositories use parameterized SQL and explicit publication filters.
  Draft tournaments, inactive games, future posts, private team fields, and
  draft media are never projected publicly.
- `/admin/login` verifies the application-owned credential. Password
  verifiers use PBKDF2-HMAC-SHA256 with 600,000 iterations, a random 16-byte
  salt, and the 32-byte `ADMIN_AUTH_PEPPER`. Login admission is atomically
  limited by both account and client-network fingerprints.
- Login admission locks the network dimension first. Once a network is
  blocked, sprayed usernames create no account rows. Each login also performs
  a private, 64-row bounded cleanup of session and throttle state older than
  the 24-hour retention boundary.
- A successful login issues a random 256-bit, `HttpOnly`, `SameSite=Strict`
  cookie. PostgreSQL stores only its SHA-256 digest and enforces a sliding
  30-minute idle expiry, an 8-hour absolute expiry, logout/revocation, and a
  five-session-family cap. Unsafe methods also require same-origin CSRF
  evidence.
- Session admission is idempotent for its random token digest. A retry can
  recover a response lost after PostgreSQL commit without consuming a second
  family; a failed retry makes a best-effort server-side revocation.
- The cookie token is deliberately fixed for its session instead of being
  rotated mid-session. This simplifies concurrent requests and cookie updates,
  but a stolen live token can be replayed until logout, revocation, idle
  expiry, or the 8-hour absolute deadline. HTTPS, cookie flags, short idle
  expiry, and credential rotation reduce but do not remove that residual risk.
- `/media/*` serves only published database records; draft previews use the
  authenticated `/admin/media/*` route. Unauthorized and absent objects are
  indistinguishable 404 responses; dependency outages are 503 responses.
- Registration and match mutations remain atomic database functions. Migration
  021 replaces advisory locks with Hyperdrive-compatible row locks.
- Hyperdrive query caching and OpenNext persistent data caches are disabled for
  the first cutover so read-after-write behavior is correct.

See [runtime architecture](docs/architecture.md), [migration rules](docs/migrations.md),
and the [Cloudflare release checklist](docs/cloudflare-release.md).

## Deployment ownership

The real Cloudflare account, Hyperdrive configuration, private R2 bucket,
domains, secrets, and deployment authority belong to `@Egger0`. This
repository contains the reviewed code and binding contract; contributors must
not deploy it from a personal Cloudflare account. The Wrangler Hyperdrive
marker is replaced only by `@Egger0` with the ID from the target account.

The repository neither creates nor changes account-side Cloudflare Access
configuration. If the target account still has an Access application from an
older release, the account owner removes it only after the application-owned
login has been promoted and verified; see the release and rollback order in
the checklist.

Before release, copy existing media to R2 with identical keys and verify count,
size, and checksum coverage. Keep the source intact until the rollback window
has closed.
