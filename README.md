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

| Script | |
|---|---|
| `stack:up` | Local PostgreSQL and PostgREST, applies `migrations/` |
| `stack:seed` | Demo fixtures, local only |
| `stack:down` | Destroys the local stack |
| `photos:import` | Decodes legacy base64 photos to files and SQL |
| `typecheck` `lint` `build` | Pipeline gates |
| `e2e` | Browser tests against a running server |

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
| `RDB_BASE_URL` | Overrides the data endpoint, local only |

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
| `migrations/` | Numbered, re-runnable |
| `seeds/` | Demo data, never production |
| `scripts/` | One-off migration tools |

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

Public reads use `team_public` and `player_public`. Neither exposes `contact`.

## Deploy

Build the image from the `Dockerfile` and run it on CloudBase Cloud Run, port 3000.

Migrations run in the CloudBase SQL editor in numbered order.
