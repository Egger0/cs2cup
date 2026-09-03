# CS2 Cup

Tournament and club website for the NingboTech Esports Club.

Production: <https://cn.nbtesportsclub.online>

## Stack

- Next.js 16 and React 19
- Cloudflare Workers through OpenNext
- Cloudflare D1 and R2

## Local development

Requires Node.js 24 and npm 11. A Cloudflare account or credentials are not required.

```sh
npm ci
npm run db:local:seed
npm run dev
```

`npm run dev` applies pending migrations and starts the site at `http://localhost:3000`.
Local D1 and R2 state is stored under `.local/cloudflare`.

Useful database commands:

```sh
npm run db:local:migrate
npm run db:local:seed
npm run db:local:reset
```

The seed login is `local-admin` / `local-admin`. It exists only in local fixture data.

## Environment boundary

Contributor commands use [`wrangler.local.jsonc`](./wrangler.local.jsonc). Its D1 and R2
bindings are local-only, remote bindings are disabled in code, and telemetry is disabled.
Browser checks also reject non-loopback origins and outbound requests.

[`wrangler.jsonc`](./wrangler.jsonc) is deployment configuration. `npm run cf:build` uses it to
produce the same bundle as Workers Builds without deploying. In a production-branch Workers Build,
its guarded post-build hook applies pending D1 migrations before publication. Use
`npm run cf:build:local` to validate the local-only bindings. The protected Workers Builds deploy
command is `npm run deploy`; it rechecks migrations before publishing the already-built Worker.
Non-production Workers Builds upload an isolated preview version without migrations or traffic
promotion. Contributors must not run remote migrations or deploy from local machines.

## Configuration

| Variable                                   | Production | Purpose                                           |
| ------------------------------------------ | ---------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                     | Required   | Canonical HTTP(S) origin                          |
| `HOME_PREVIEW_COUNTDOWN`                   | Optional   | Allows fallback data in local previews            |
| `REGISTRATION_FINGERPRINT_SECRET`          | Required   | Root secret for abuse and identity key derivation |
| `REGISTRATION_CLIENT_IP_SOURCE`            | Required   | Trusted client IP header                          |
| `IDENTITY_PASSWORD_PEPPERS`                | Optional   | Versioned dedicated password pepper JSON          |
| `IDENTITY_PASSWORD_ACTIVE_PEPPER_VERSION`  | Optional   | Active password pepper version                    |
| `IDENTITY_AUTH_FINGERPRINT_KEYS`           | Optional   | Versioned dedicated auth fingerprint key JSON     |
| `IDENTITY_AUTH_FINGERPRINT_ACTIVE_VERSION` | Optional   | Active auth fingerprint key version               |

Never commit credentials or production secrets. If the dedicated identity key pairs are omitted,
the required registration fingerprint secret is domain-separated into stable password-pepper and
authentication-fingerprint keys. Configure both values of a dedicated pair together and retain old
password pepper versions while credentials still reference them.

## Quality

```sh
npm run check
npm run cf:build
npm run cf:size
npm run cf:build:local
```

`npm run check` covers formatting, types, ESLint, deterministic offline tests, repository
safety, and source-size limits. Browser checks run separately against a local server:

```sh
npm run a11y
npm run keyboard
npm run perf
```

Repository documentation, configuration, comments, identifiers, and file names use English, except
for explicitly localized product-copy specifications. User-facing copy may use Chinese. Source files
are limited to 300 non-empty lines.

## Architecture contracts

- [`docs/identity-architecture.md`](./docs/identity-architecture.md) defines the unified account,
  authentication, session, authorization, recovery, migration, and identity UI contract.
- [`docs/identity-stack-decision.md`](./docs/identity-stack-decision.md) assigns implementation
  ownership and records the authentication-stack decision.
- [`docs/identity-product-language.zh-CN.md`](./docs/identity-product-language.zh-CN.md) is the
  localized identity terminology and interface-copy contract.
- [`docs/performance-budget.md`](./docs/performance-budget.md) defines Worker and browser budgets and
  explains which resources belong in the Worker, Static Assets, or R2.

## Structure

| Path                  | Responsibility                         |
| --------------------- | -------------------------------------- |
| `app`                 | Public and admin routes                |
| `components`          | UI, layout, and domain components      |
| `lib/queries`         | Public and authenticated data access   |
| `lib`                 | Domain and infrastructure code         |
| `cloudflare/d1`       | Schema and production migrations       |
| `cloudflare/fixtures` | Local deterministic fixture data       |
| `scripts`             | Local tooling and deterministic checks |
| `.github/workflows`   | Quality and repository automation      |
