# cs2cup

宁波理工电竞社赛事站：报名、战队、签表、赛程、战报、内容和后台管理。

The production stack is deliberately small:

- Next.js 16 + React 19 on Cloudflare Workers through OpenNext;
- Cloudflare Access as the only administrator session and authorization layer;
- Hyperdrive to the existing PostgreSQL database;
- a private R2 bucket for media.

There is no CloudBase SDK, PostgREST transport, D1 application database,
application login, or application-owned session runtime.

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

The public site works locally without an Access identity. Use
`npm run e2e:admin` for a fully isolated administrator flow with a local signed
Access assertion. Manual administrator testing should run behind the target
Access application or a trusted development proxy that injects the assertion
header; the app intentionally has no local password bypass.

## Commands

| Command | Purpose |
|---|---|
| `npm run stack:up` | Start PostgreSQL and apply expand + contract migrations |
| `npm run stack:seed` | Insert local demo fixtures |
| `npm run stack:migrate` | Apply append-only expand migrations |
| `npm run stack:contract` | Apply post-deploy contractions after old instances drain |
| `npm run stack:adopt` | One-time verified adoption of an unledgered migration-012 database |
| `npm run typecheck` / `lint` / `build` | Static and Next.js gates |
| `npm run cf:check` | OpenNext build plus compressed Worker size budget |
| `npm run test:cloudflare-access` | Access JWT, JWKS, header, cookie, and failure boundaries |
| `npm run test:hyperdrive-runtime` | Direct-runtime role, RPC, row-lock, and retired-session boundaries |
| `npm run test:r2-storage` | Private R2 object-store contract |
| `npm run test:registration-rate-limit` | Sequential and concurrent atomic registration limits |
| `npm run e2e` | Public browser suite against a running application |
| `npm run e2e:admin` | Isolated database, Access, application, and admin browser suite |
| `npm run check` | Complete local quality gate |

`e2e:admin` owns every temporary resource it creates: a uniquely named
database, an application process, a local JWKS server, an object root, and a
temporary build context. It validates the database name before the first write
and removes only those exact resources in `finally` cleanup.

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Direct PostgreSQL URL for local Next.js/standalone only |
| `CF_ACCESS_ISSUER` | Exact `https://<team>.cloudflareaccess.com` origin |
| `CF_ACCESS_AUDIENCE` | Exact Access application AUD tag |
| `NEXT_PUBLIC_SITE_URL` | Exact public HTTP(S) origin |
| `PHOTO_UPLOAD_DRIVER` | `local` in development, `r2` on Cloudflare |
| `PHOTO_LOCAL_ROOT` | Absolute private object root for local development |
| `REGISTRATION_FINGERPRINT_SECRET` | Dedicated secret, at least 32 bytes outside development |
| `REGISTRATION_CLIENT_IP_SOURCE` | Trusted ingress header: `x-real-ip` or `cf-connecting-ip` |
| `HOME_PREVIEW_COUNTDOWN` | `1` only for the explicit data-free visual preview |

Wrangler binds `CS2CUP_DATABASE` and `CS2CUP_MEDIA`; they are not process
environment variables. Never commit database URLs, Access tokens, API tokens,
or R2 credentials.

## Runtime boundaries

- Public repositories use parameterized SQL and explicit publication filters.
  Draft tournaments, inactive games, future posts, private team fields, and
  draft media are never projected publicly.
- `/admin*` is protected at the Access edge and the Worker independently
  validates the assertion. Unsafe methods also require same-origin CSRF
  evidence.
- `/media/*` serves only published database records; draft previews use the
  Access-protected `/admin/media/*` route. Unauthorized and absent objects are
  indistinguishable 404 responses; dependency outages are 503 responses.
- Registration and match mutations remain atomic database functions. Migration
  021 replaces advisory locks with Hyperdrive-compatible row locks.
- Hyperdrive query caching and OpenNext persistent data caches are disabled for
  the first cutover so read-after-write behavior is correct.

See [runtime architecture](docs/architecture.md), [migration rules](docs/migrations.md),
and the [Cloudflare release checklist](docs/cloudflare-release.md).

## Deployment ownership

The real Cloudflare account, Access policy, Hyperdrive configuration, R2
bucket, domains, and deployment authority belong to `@Egger0`. This repository
contains the reviewed code and binding contract; contributors must not deploy
it from a personal Cloudflare account. The Wrangler Hyperdrive marker is
replaced only by `@Egger0` with the ID from the target account.

Before release, copy existing media to R2 with identical keys and verify count,
size, and checksum coverage. Keep the source intact until the rollback window
has closed.
