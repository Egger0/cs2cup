# cs2cup

Esports club site for Ningbo Institute of Technology, Zhejiang University. Registration, rosters, brackets, match reports with ban/pick, archive, admin.

Next.js App Router · React · TypeScript · CloudBase PostgreSQL · Cloud Run

## Develop

```bash
npm install
npm run stack:up
npm run stack:seed
cp .env.example .env.local
npm run dev
```

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
| `stack:up` | Local PostgreSQL and PostgREST, applies `migrations/` |
| `stack:seed` | Demo fixtures, local only |
| `stack:down` | Destroys the local stack |
| `photos:import` | Decodes legacy base64 photos to files and SQL |
| `typecheck` `lint` `build` | Pipeline gates |
| `test:security-boundaries` | Public/private data and local-role regressions |
| `test:registration-fingerprint` | Trusted-address normalization and HMAC unit tests |
| `test:registration-rate-limit` | Sequential and concurrent atomic rate-limit tests |
| `a11y` | axe across 14 pages, zero violations expected |
| `keyboard` | Focus order, skip link, dialog and drawer |
| `perf` | Transfer, JS, image, font, LCP and CLS against a budget |
| `check` | Everything above in sequence |
| `e2e` | Public browser tests, 23 behaviours |
| `e2e:admin` | Console write tests, requires a dev session |
| `serve` | Build, pack the standalone bundle, run it |

For a server that is not running on port 3000, set `E2E_BASE_URL` before `npm run e2e`.
For example, in PowerShell: `$env:E2E_BASE_URL = 'http://127.0.0.1:3100'; npm run e2e`.
Use `E2E_DB_NAME` to run the admin suite against an isolated database and
`E2E_RDB_BASE_URL` when the public PostgREST test endpoint uses another port.

### Visual preview without data

For homepage visual adjustments without CloudBase or the local database, build and run the production container with the preview flag:

```powershell
docker build -t cs2cup-local .
docker run --rm --name cs2cup-local -p 3100:3000 -e HOME_PREVIEW_COUNTDOWN=1 -e NEXT_PUBLIC_SITE_URL=http://localhost:3100 cs2cup-local
```

Open `http://localhost:3100`. The flag uses static fallbacks and displays the homepage countdown card as an unscheduled local preview. Do not set it in Cloud Run.

## Environment

| Variable | |
|---|---|
| `CLOUDBASE_ENV_ID` | CloudBase environment |
| `CLOUDBASE_ANON_KEY` | Publishable key, public reads |
| `CLOUDBASE_ADMIN_KEY` | Privileged key, admin writes |
| `CLOUDBASE_REGION` | Defaults to `ap-shanghai` |
| `RDB_BASE_URL` | Overrides the read endpoint, local only |
| `RDB_ADMIN_BASE_URL` | Overrides the write endpoint, local only |
| `CLOUDBASE_ISSUER` | Overrides the OIDC issuer, local only |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin for sitemap, feed and cards |
| `PHOTO_UPLOAD_DRIVER` | `local` or `cloudbase`; defaults to `local` |
| `PHOTO_LOCAL_ROOT` | Where the local driver writes; defaults to a temporary directory |
| `PHOTO_BUCKET` | CloudBase PG Storage bucket; defaults to `cs2cup-photos` |
| `REGISTRATION_FINGERPRINT_SECRET` | Dedicated secret of at least 32 bytes used to HMAC client addresses; required outside development |
| `REGISTRATION_CLIENT_IP_HEADER` | Trusted ingress header: `x-real-ip` or `cf-connecting-ip`; defaults to `x-real-ip` |

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
| `migrations/` | Numbered, re-runnable |
| `seeds/` | Demo data, never production |
| `scripts/` | Migration tools, browser tests, dev session |

`components/ui/` must not import `lib/types.ts`.

Body text uses the platform CJK stack. The webfont is reserved for headings,
where the heavy Chinese title carries the identity. That choice costs about
200KB and is the reason the font budget is what it is.

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

Public reads use `team_public`, `player_public`, `match_map_public` and
`photo_public`. These views exclude records attached to draft tournaments;
`team_public` also omits `contact` and `note`. Base-table RLS enforces the same
tournament boundary for matches, match maps and photos. Posts remain private
until `published_at`.

`submit_team_rate_limited` is executable only by `club_admin`. The server action
derives an HMAC fingerprint from the trusted client address, and the database
checks, records and executes each attempt in one atomic transaction.
Development uses a process-local random key and loopback address when ingress
headers are absent. Production instead fails closed unless the dedicated key
and configured trusted ingress header are available.

Generate a production secret with a cryptographically secure password manager
or `openssl rand -base64 32`. Configure only an address header that the trusted
ingress overwrites; never trust a client-supplied forwarding header. Use
`cf-connecting-ip` only when the origin accepts traffic exclusively from
Cloudflare.

After applying the migrations, verify the security boundaries independently:

```bash
npm run test:security-boundaries
npm run test:registration-fingerprint
npm run test:registration-rate-limit
```

## Deploy

Build the image from the `Dockerfile` and run it on CloudBase Cloud Run, port 3000.

Migrations run in the CloudBase SQL editor in numbered order.

For persistent photos, run `migrations/010_photo_storage.sql`, then set
`PHOTO_UPLOAD_DRIVER=cloudbase` and `PHOTO_BUCKET=cs2cup-photos` in Cloud Run.
The existing server-only `CLOUDBASE_ENV_ID` and `CLOUDBASE_ADMIN_KEY` authorize
the private bucket; browsers continue to read photos only through `/media/...`.
