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

The local stack runs PostgREST twice: port 53000 as `anon`, port 53001 as
`club_admin`. Point `RDB_BASE_URL` and `RDB_ADMIN_BASE_URL` at them.

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
| `e2e` | Public browser tests, 23 behaviours |
| `e2e:admin` | Console write tests, requires a dev session |
| `serve` | Build, pack the standalone bundle, run it |

For a server that is not running on port 3000, set `E2E_BASE_URL` before `npm run e2e`.
For example, in PowerShell: `$env:E2E_BASE_URL = 'http://127.0.0.1:3100'; npm run e2e`.

## Environment

| Variable | |
|---|---|
| `CLOUDBASE_ENV_ID` | CloudBase environment |
| `CLOUDBASE_ANON_KEY` | Publishable key, public reads |
| `CLOUDBASE_ADMIN_KEY` | Privileged key, admin writes |
| `CLOUDBASE_REGION` | Defaults to `ap-shanghai` |
| `NEXT_PUBLIC_PHOTO_BASE_URL` | Object storage origin |
| `RDB_BASE_URL` | Overrides the read endpoint, local only |
| `RDB_ADMIN_BASE_URL` | Overrides the write endpoint, local only |
| `CLOUDBASE_ISSUER` | Overrides the OIDC issuer, local only |
| `NEXT_PUBLIC_SITE_URL` | Absolute origin for sitemap, feed and cards |
| `PHOTO_UPLOAD_DRIVER` | `local` or `cos`; defaults to `local` |
| `PHOTO_LOCAL_ROOT` | Where the local driver writes; defaults to `public/photos` |
| `COS_UPLOAD_URL` `COS_UPLOAD_TOKEN` | Object storage endpoint and credential |

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

Public reads use `team_public` and `player_public`. Neither exposes `contact`.

`submit_team` is executable only by `club_admin`, so entries must pass through
the server action, which rate-limits by hashed address and user agent.

## Deploy

Build the image from the `Dockerfile` and run it on CloudBase Cloud Run, port 3000.

Migrations run in the CloudBase SQL editor in numbered order.
