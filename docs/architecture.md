# Runtime architecture

The production runtime has three Cloudflare-native boundaries:

```text
Browser
  ├─ public pages ───────────────┐
  ├─ /admin* → Access Policy ───┼─ Worker / OpenNext
  └─ /media/* ──────────────────┘       ├─ Hyperdrive → PostgreSQL
                                       └─ private R2 bucket
```

## Access

Cloudflare Access is the only administrator session and authorization source.
The Worker still validates every `Cf-Access-Jwt-Assertion` against the exact
team issuer, application audience, RS256 signature, expiry, and subject.
Unsafe admin requests also require an exact same-origin CSRF signal.

There is no application login endpoint, password flow, administrator cookie,
or database allowlist in the request path. `/cdn-cgi/access/logout` owns logout.
The Access application must cover both `/admin` and `/admin/*` on every
reachable hostname; an unprotected `workers.dev` or alternate hostname is an
authorization bypass. Wrangler disables both `workers.dev` and version preview
URLs; the production route is attached only in the target account.

## PostgreSQL

`lib/database.ts` owns the single database capability. In Cloudflare it reads
the `CS2CUP_DATABASE` Hyperdrive binding; local standalone tests use
`DATABASE_URL`. A React request cache creates one Hyperdrive `postgres.js`
client per request (never per isolate), capped at five edge connections. The
long-running local Node process reuses a standalone-only pool, and the boundary
normalizes bigint and timestamp values.

All SQL is parameterized. Public reads include explicit publication predicates
and use the `*_public` security-barrier views for teams, players, match maps,
and photos. Admin mutations require a verified Access request before they reach
the repository.

Business operations that span rows remain atomic PostgreSQL functions behind
the `public.*` SECURITY DEFINER RPC boundary. Migration 021 replaces their
unsupported advisory locks with transaction-scoped row locks. Hyperdrive query
caching is disabled initially because the application requires read-after-write
correctness; a second read-only cached binding can be introduced later with
explicit invalidation evidence.

## Media

R2 is private. `/media/*` validates the object key and serves only photos whose
database record is published. Draft previews use `/admin/media/*`, remain
inside the Access application, and require the injected Access assertion; the
application never accepts a bearer cookie on an unprotected media route.
Missing or unauthorized objects return the same 404; database or storage
outages return 503. Every response is private and `no-store`.

Photo upload uses compensating operations across PostgreSQL and R2:

- upload: write R2, insert PostgreSQL, delete the object if insertion fails;
- delete: delete PostgreSQL first, then best-effort delete R2.

This is deliberately not presented as a distributed transaction.

## Cache baseline

OpenNext incremental, tag, and queue caches use the explicit dummy adapters.
Public pages are request-rendered and database reads are fresh. This is the
smallest correct baseline; persistent cache adapters should be added only with
cross-isolate invalidation tests.
