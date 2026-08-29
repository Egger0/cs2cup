# Runtime architecture

The production runtime has three data boundaries and an application-owned
administrator boundary:

```text
Browser
  ├─ public pages ─────────────────────┐
  ├─ /admin/login ─────────────────────┼─ Worker / OpenNext
  ├─ authenticated /admin/* ───────────┤       ├─ Hyperdrive → PostgreSQL
  └─ /media/* and /admin/media/* ──────┘       └─ private R2 bucket
```

Cloudflare Access and Zero Trust are not runtime dependencies. Authentication,
session validation, authorization checks, and logout are implemented by the
application and PostgreSQL.

## Administrator authentication

Migration 022 stores administrator credentials in
`app_private.local_admin_credential`, tied to the existing stable Principal and
`public.admin_user` records. The table and its provisioning function are not
available to the Hyperdrive runtime role. A migration-owner direct connection
initializes or rotates a credential with `admin:credential`; the raw password
is accepted only on standard input and is never persisted.

The verifier is derived in the trusted Worker and provisioning command:

1. Normalize the username and password to NFC.
2. Key the password with HMAC-SHA256 using the 32-byte
   `ADMIN_AUTH_PEPPER` and a versioned application context.
3. Apply PBKDF2-HMAC-SHA256 for 600,000 iterations with a fresh random
   16-byte salt.
4. Persist only the algorithm, work factor, salt, and 32-byte derived verifier.

The pepper is an independent Worker secret and must not be stored in
PostgreSQL, Wrangler configuration, source control, build output, or logs.
Unknown users take the same 600,000-iteration dummy derivation path as known
users, and invalid credentials return one generic response. Migration 022
rejects any other work factor so per-account KDF time cannot become an account
existence signal; a future work-factor change must update every verifier and
the sentinel together in a forward migration.

Every login attempt atomically consumes two keyed-fingerprint limits in
PostgreSQL:

- account: five attempts per 15-minute window;
- trusted client network address: 30 attempts per 15-minute window.

The next attempt over either limit blocks that dimension for 15 minutes and
returns `Retry-After`. Admission always locks network before account. Once the
network dimension is blocked, it does not read or create an account row, so a
single blocked source cannot grow the table by spraying new usernames. A
successful login clears only its account dimension. The network source is the
configured trusted ingress header; arbitrary forwarded headers are not
accepted.

Every login also invokes the private session/throttle cleanup function with a
hard limit of 64 rows per category. Rows remain for 24 hours for replay and
audit handling, then opportunity-driven cleanup drains them faster than the
login endpoint can create them. The cleanup capability is not exposed to the
runtime database role as a separate public RPC.

## Administrator sessions

A successful login creates a random 32-byte (256-bit) base64url token. The
browser receives it in the `cs2cup_admin` cookie with `HttpOnly`,
`SameSite=Strict`, `Path=/`, high priority, and `Secure` on HTTPS. PostgreSQL
stores only the token's SHA-256 digest and the session family. At most five
live families are admitted for one Principal.

Each authenticated request looks up the digest and atomically validates the
Principal, administrator mapping, revocation state, and expiry. Activity moves
the idle deadline to 30 minutes from the current request, capped by the fixed
8-hour absolute deadline. Logout revokes the database session before expiring
the browser cookie. Credential initialization or rotation increments the
credential version and revokes every previous session for that Principal in
the same transaction.

Session admission is idempotent for the random token digest. If Hyperdrive
loses the response after PostgreSQL committed, the Worker retries once with
the same digest and request ID and receives the existing family instead of
creating another one. If that retry also fails, it attempts to revoke the same
digest before returning the generic unavailable response.

The current application deliberately keeps one token for the full session;
the historical 15-minute `rotate_after` field is not used for mid-session
rotation. This avoids races between concurrent React/Worker requests and
cookie replacement, but it leaves a known residual risk: anyone who steals a
live cookie can replay it until logout, credential rotation, administrative
revocation, 30 minutes of inactivity, or the 8-hour absolute deadline. TLS,
strict cookie flags, digest-only storage, and the short idle boundary reduce
the exposure but do not make a stolen token harmless.

`/admin/login` and all unsafe methods require exact same-origin CSRF evidence.
Every admin page, server action, and draft-media read also calls the server-side
session boundary; knowledge of an object key or direct route is not
authorization.

## PostgreSQL

`lib/database.ts` owns the single database capability. In Cloudflare it reads
the `CS2CUP_DATABASE` Hyperdrive binding; local standalone tests use
`DATABASE_URL`. A React request cache creates one Hyperdrive `postgres.js`
client per request (never per isolate), capped at five edge connections. The
long-running local Node process reuses a standalone-only pool, and the boundary
normalizes bigint and timestamp values.

The Hyperdrive origin uses a dedicated, private PostgreSQL login that inherits
`club_admin` and no broader role. Its password exists only in the target
account's approved secret workflow and Hyperdrive configuration. It is not an
administrator's browser credential and is never exposed as a Worker variable.
Migrations and credential provisioning use a separate direct TLS connection,
not the runtime login or Hyperdrive endpoint.

All SQL is parameterized. Public reads include explicit publication predicates
and use the `*_public` security-barrier views for teams, players, match maps,
and photos. Admin mutations require a valid application session before they
reach the repository.

Business operations that span rows remain atomic PostgreSQL functions behind
the `public.*` `SECURITY DEFINER` RPC boundary. Migration 021 replaces their
unsupported advisory locks with transaction-scoped row locks. Migration 022
exposes only four newly named, trusted-service authentication RPCs:

- `begin_local_admin_login`;
- `create_local_admin_session`;
- `use_local_admin_session`;
- `end_local_admin_session`.

The provider-oriented RPCs removed by the historical migration-021 contraction
remain removed. Hyperdrive query caching is disabled initially because the
application requires read-after-write correctness; a second read-only cached
binding can be introduced later only with explicit invalidation evidence.

## Media

R2 is private. `/media/*` validates the object key and serves only photos whose
database record is published. Draft previews use `/admin/media/*` and require
the application-owned administrator session. The application never accepts a
bearer cookie on an unprotected media route. Missing or unauthorized objects
return the same 404; database or storage outages return 503. Every response is
private and `no-store`.

Photo upload uses compensating operations across PostgreSQL and R2:

- upload: write R2, insert PostgreSQL, delete the object if insertion fails;
- delete: delete PostgreSQL first, then best-effort delete R2.

This is deliberately not presented as a distributed transaction.

## Cache baseline

OpenNext incremental, tag, and queue caches use the explicit dummy adapters.
Public pages are request-rendered and database reads are fresh. This is the
smallest correct baseline; persistent cache adapters should be added only with
cross-isolate invalidation tests.
