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

[`wrangler.jsonc`](./wrangler.jsonc) is deployment configuration. `npm run cf:build`
uses it to produce the same bundle as Workers Builds without deploying. Use
`npm run cf:build:local` to validate the local-only bindings. Remote migrations and deployment
belong only in protected maintainer automation and are intentionally absent from package scripts.

## Configuration

| Variable                          | Production | Purpose                                |
| --------------------------------- | ---------- | -------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`            | Required   | Canonical HTTP(S) origin               |
| `HOME_PREVIEW_COUNTDOWN`          | Optional   | Allows fallback data in local previews |
| `REGISTRATION_FINGERPRINT_SECRET` | Required   | HMAC secret for anonymous abuse limits |
| `REGISTRATION_CLIENT_IP_SOURCE`   | Required   | Trusted client IP header               |

Never commit credentials or production secrets.
The fingerprint secret is domain-separated between registration and administrator sign-in use.

## Quality

```sh
npm run check
npm run cf:build
npm run cf:build:local
```

`npm run check` covers formatting, types, ESLint, deterministic offline tests, repository
safety, and source-size limits. Browser checks run separately against a local server:

```sh
npm run a11y
npm run keyboard
npm run perf
```

Repository documentation, configuration, comments, identifiers, and file names use English.
User-facing copy may use Chinese. Source files are limited to 300 non-empty lines.

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
